// SPDX-License-Identifier: AGPL-3.0-or-later
// SPDX-FileCopyrightText: 2026 PON Cut contributors
import { mkdir, access, rename, rm, mkdtemp, cp } from 'node:fs/promises';
import { createWriteStream, createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const version='0.2.8';
const vendor=fileURLToPath(new URL('../../vendor/',import.meta.url));
const binary=process.env.CONCAT_BINARY||path.join(vendor,'Concat.app/Contents/MacOS/concat');
try {
  await access(binary);
  console.log(execFileSync(binary,['--version'],{encoding:'utf8'}).trim());
  console.log('Engine ready. Run npm start.');
  process.exit(0);
} catch { /* install a pinned, official build below */ }
if(process.env.CONCAT_BINARY)throw new Error('CONCAT_BINARY does not name a working Concat executable. Correct it or unset it to install the bundled engine.');
if(process.platform!=='darwin'||!['arm64','x64'].includes(process.arch)){
  console.error('Automatic setup supports macOS. Install official Concat 0.2.8 or build it from src/, set CONCAT_BINARY to its executable, and run npm start. See web/README.md.');
  process.exit(1);
}
const architecture=process.arch==='x64'?'x86_64':'arm64';
const name=`Concat-${version}-macos-${architecture}.dmg`;
const checksums={arm64:'4fe1820f36235efe8a28379a224239032c260bef1ad0fb950274c2f832e91805',x86_64:'c040bd5c14b6de6443dd9c4e00070e57beafcf7cd6347dfc19b8559843bc16e6'};
await mkdir(vendor,{recursive:true});
const image=path.join(vendor,name);
try {await access(image);}catch{
  console.log(`Downloading official Concat ${version} (${architecture})…`);
  const response=await fetch(`https://github.com/jub0t/Concat/releases/download/v${version}/${name}`,{signal:AbortSignal.timeout(300000)});
  if(!response.ok||!response.body)throw new Error(`Download failed: ${response.status}`);
  try {await pipeline(Readable.fromWeb(response.body),createWriteStream(image+'.partial'));await rename(image+'.partial',image);}
  catch(e){await rm(image+'.partial',{force:true});throw e;}
}
const digest=createHash('sha256');for await(const chunk of createReadStream(image))digest.update(chunk);
if(digest.digest('hex')!==checksums[architecture])throw new Error(`Checksum mismatch. Remove ${image} and retry; the downloaded image was not installed.`);
const mount=await mkdtemp(path.join(tmpdir(),'pon-cut-mount-'));
let mounted=false;
try{
  execFileSync('hdiutil',['attach',image,'-nobrowse','-readonly','-mountpoint',mount],{stdio:'inherit'});mounted=true;
  await cp(path.join(mount,'Concat.app'),path.join(vendor,'Concat.app'),{recursive:true});
}finally{
  if(mounted)execFileSync('hdiutil',['detach',mount],{stdio:'inherit'});
  await rm(mount,{recursive:true,force:true});
}
console.log(execFileSync(binary,['--version'],{encoding:'utf8'}).trim());
console.log('Engine verified and installed inside this repository. Run npm start.');
