import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import vm from 'node:vm';import {zstdCompressSync}from'node:zlib';
const base=process.env.MAESTRO_TEST_ROOT;if(!base)throw Error('Run npm run test:maestro');const mod=await import(base+'/lib/resume.js');const temp=fs.mkdtempSync(path.join(os.tmpdir(),'maestro-v4-test-'));const group=path.join(temp,'sessions','manual');fs.mkdirSync(group,{recursive:true});
const entry=(type,turn,extra={})=>JSON.stringify({type,time:Date.now(),data:{turn,...extra}})+'\n';
function fixture(id,text,compressed=true){const dir=path.join(group,id);fs.mkdirSync(dir);fs.writeFileSync(path.join(dir,compressed?'session.v4.jsonl.zstd':'session.v4.jsonl'),compressed?zstdCompressSync(Buffer.from(text)):text);return dir;}
test('v4 compressed journal preferred over v3/legacy',()=>{const dir=fixture('order',entry('turn/end',1,{reason:{kind:'completed'}}));fs.writeFileSync(path.join(dir,'session.v3.jsonl.zstd'),Buffer.from('old'));assert.equal(mod.resolveSessionLogPath(dir),path.join(dir,'session.v4.jsonl.zstd'));});
test('native decoding works without external zstd',()=>{const dir=fixture('native',entry('turn/start',1)+entry('tool/call',1,{name:'bash',callId:'test-call'}));assert.equal(mod.readSessionLogLines(mod.resolveSessionLogPath(dir)).length,2);});
test('all concatenated frames are decoded, not just the header',()=>{const dir=fixture('multi',entry('session',0));fs.appendFileSync(path.join(dir,'session.v4.jsonl.zstd'),zstdCompressSync(Buffer.from(entry('turn/start',1))));fs.appendFileSync(path.join(dir,'session.v4.jsonl.zstd'),zstdCompressSync(Buffer.from(entry('tool/call',1,{name:'bash'}))));assert.equal(mod.readSessionLogLines(mod.resolveSessionLogPath(dir)).length,3);});
test('partial JSON line preserves open-turn detection',async()=>{fixture('partial-json',entry('turn/start',1)+'{"type":"tool/result"',false);const r=await mod.findDanglingOpenTurns(temp,{sinceMs:0});assert.ok(r.interrupted.includes('manual/partial-json'));});
test('incomplete final compressed frame preserves complete event prefix',async()=>{const dir=fixture('partial-frame',entry('turn/start',1));const frame=zstdCompressSync(Buffer.from(entry('tool/result',1)));fs.appendFileSync(path.join(dir,'session.v4.jsonl.zstd'),frame.subarray(0,frame.length-3));const lines=mod.readSessionLogLines(mod.resolveSessionLogPath(dir));assert.ok(lines.some(l=>JSON.parse(l).type==='turn/start'));assert.ok((await mod.findDanglingOpenTurns(temp,{sinceMs:0})).interrupted.includes('manual/partial-frame'));});
test('latest completed turn does not revive an older interruption',async()=>{fixture('completed',entry('turn/start',1)+entry('turn/end',1,{reason:{kind:'interrupted'}})+entry('turn/start',2)+entry('turn/end',2,{reason:{kind:'completed'}}));assert.ok(!(await mod.findInterrupted(temp,{sinceMs:0})).interrupted.includes('manual/completed'));assert.ok(!(await mod.findDanglingOpenTurns(temp,{sinceMs:0})).interrupted.includes('manual/completed'));});
test('DSH 0.2 direct Agent and wrapped Agent both activate through controller',async()=>{const source=fs.readFileSync(base+'/lib/plugin.js','utf8');const a=source.indexOf('export async function activateSessionAgent('),b=source.indexOf('export async function resumeInterrupted(',a);const fn=vm.runInNewContext(source.slice(a,b).replace('export async function','async function')+'\nactivateSessionAgent');const calls=[];const agent={followup(){}};for(const result of [agent,{agent}]){const ctx={get:()=>({resolveAgent:async id=>{calls.push(id);return result;}})};const resolved=await fn(ctx,'manual-test');assert.equal(resolved.agent,agent);assert.equal(resolved.via,'controller');}assert.deepEqual(calls,['manual-test','manual-test']);});
test.after(()=>fs.rmSync(temp,{recursive:true}));

test('raw route fallback decodes synthetic v4 without external zstd',async()=>{
 const source=fs.readFileSync(base+'/lib/plugin.js','utf8');const a=source.indexOf('function routeFromEvents('),b=source.indexOf('export async function recoverAgentOptions(',a);const defs=source.slice(a,b).replace(/export /g,'');const route=vm.runInNewContext(defs+'\nreadRouteFromRawLog',{fs,path,resolveSessionLogPath:mod.resolveSessionLogPath,readSessionLogLines:mod.readSessionLogLines});
 fixture('route',JSON.stringify({type:'request/context',data:{provider:'example-provider',model:'example-model'}})+'\n');
 const actual=await route(path.join(temp,'sessions'),'manual','route');assert.equal(actual?.provider,'example-provider');assert.equal(actual?.model,'example-model');
});

test('a magic marker inside a valid raw-block payload is not a frame boundary',()=>{
 const payload=Buffer.concat([Buffer.from(entry('turn/start',1)),Buffer.from([0x28,0xb5,0x2f,0xfd]),Buffer.from('\n')]);
 const header=Buffer.from([0x28,0xb5,0x2f,0xfd,0x20,payload.length]);
 const block=Buffer.alloc(3);block.writeUIntLE((payload.length<<3)|1,0,3);
 const dir=path.join(group,'embedded-magic');fs.mkdirSync(dir);const log=path.join(dir,'session.v4.jsonl.zstd');
 const tail=entry('tool/call',1);fs.writeFileSync(log,Buffer.concat([header,block,payload,zstdCompressSync(Buffer.from(tail))]));
 assert.deepEqual(mod.readSessionLogLines(log), (payload.toString('utf8')+tail).split('\n').filter(Boolean));
});

test('UTF-8 codepoints split across frames survive concatenation',()=>{
 const bytes=Buffer.from('你好\n');const dir=path.join(group,'utf8-split');fs.mkdirSync(dir);const log=path.join(dir,'session.v4.jsonl.zstd');
 fs.writeFileSync(log,Buffer.concat([zstdCompressSync(bytes.subarray(0,1)),zstdCompressSync(bytes.subarray(1))]));
 assert.deepEqual(mod.readSessionLogLines(log),['你好']);
});
