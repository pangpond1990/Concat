// SPDX-License-Identifier: AGPL-3.0-or-later
// Exercises upstream UI callbacks, not the earlier replacement editor API.
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,stat,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {OriginalHost} from './native.mjs';
const binary=process.argv[2];if(!binary)throw new Error('Pass the native bridge binary');
const folder=await mkdtemp(path.join(os.tmpdir(),'concat-original-web-'));
const host=new OriginalHost(path.resolve(binary));
try{
 let state=await host.request('snapshot');
 assert.equal(state['App.on-start'],true);
 assert.ok(state['App.start-aspects'].length>=4,'original shape presets');
 assert.equal(state['App.start'].composing,false);
 await host.request('invoke',{name:'App.start-compose',args:[]});
 state=await host.request('snapshot');assert.equal(state['App.start'].composing,true);
 await host.request('invoke',{name:'App.start-name-edited',args:['Original UI integration']});
 await host.request('invoke',{name:'App.start-location-edited',args:[folder]});
 await host.request('invoke',{name:'App.start-aspect-changed',args:[1]});
 await host.request('invoke',{name:'App.start-create',args:[]});
 for(let i=0;i<80;i++){
  state=await host.request('snapshot');if(state['App.on-start']===false)break;
  await new Promise(r=>setTimeout(r,100));
 }
 assert.equal(state['App.on-start'],false,JSON.stringify(state['App.start']));
 assert.equal(state['App.project-name'],'Original UI integration');
 assert.ok(state['Editor.tracks'].length>=4,'original default tracks');
 await stat(path.join(folder,'Original UI integration','concat.json'));
 await host.request('invoke',{name:'Editor.library-add-text',args:['default']});
 for(let i=0;i<40;i++){
  state=await host.request('snapshot');if(state['Editor.clips']?.length)break;
  await new Promise(r=>setTimeout(r,100));
 }
 assert.equal(state['Editor.clips'].length,1,'original text creation callback');
 await host.request('invoke',{name:'Editor.undo',args:[]});
 state=await host.request('snapshot');assert.equal(state['Editor.clips'].length,0);
 console.log('PASS: original start screen, project creation, four tracks, title, undo');
}finally{host.close();await new Promise(r=>setTimeout(r,1700));await rm(folder,{recursive:true,force:true});}
