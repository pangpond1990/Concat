// SPDX-License-Identifier: AGPL-3.0-or-later
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
export class OriginalHost {
  constructor(binary) {
    this.nextId=0;this.pending=new Map();this.failure=null;
    this.child=spawn(binary,[],{stdio:['pipe','pipe','pipe'],env:{...process.env,CONCAT_WEB_BRIDGE:'1'}});
    this.child.stderr.on('data',chunk=>process.stderr.write(chunk));
    this.child.on('error',e=>this.fail(e));
    this.child.on('exit',(code,signal)=>this.fail(new Error(`Original Concat host stopped (${signal||code})`)));
    this.child.stdin.on('error',e=>this.fail(e));
    createInterface({input:this.child.stdout}).on('line',line=>{
      let message;try{message=JSON.parse(line);}catch{return;}
      const pending=this.pending.get(message.id);if(!pending)return;
      clearTimeout(pending.timer);this.pending.delete(message.id);
      message.error?pending.reject(new Error(message.error)):pending.resolve(message.result);
    });
  }
  fail(error){this.failure=error;for(const pending of this.pending.values()){clearTimeout(pending.timer);pending.reject(error);}this.pending.clear();}
  request(method,args={}) {
    if(this.failure)return Promise.reject(this.failure);
    const id=++this.nextId;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('Native UI request timed out'));},120000);
      this.pending.set(id,{resolve,reject,timer});this.child.stdin.write(JSON.stringify({id,method,...args})+'\n');
    });
  }
  close(){this.child.stdin.end();setTimeout(()=>this.child.kill(),1500).unref();}
}
