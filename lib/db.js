import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID} from 'node:crypto';
import {firebaseRequest} from './firebase.js';
import {SYSTEM_ROLES} from './roles.js';
const context=new AsyncLocalStorage();
let testTransport;
export const COLLECTIONS=['roles','departments','employees','sessions','leaves','rooms','meetings','meeting_attendees','tickets','holidays','logs','notifications'];
export const timestamp=()=>new Date().toISOString().slice(0,19).replace('T',' ');
export function emptyState(){return {meta:{schemaVersion:1,counters:{}},...Object.fromEntries(COLLECTIONS.map(name=>[name,{}]))}}
export function normalizeState(value){const state={...emptyState(),...(value||{})};for(const name of COLLECTIONS)state[name]=Object.fromEntries(Object.entries(state[name]||{}).filter(([,row])=>row!=null));state.meta={schemaVersion:1,counters:{},...state.meta};return state}
export function installTestTransport(transport){if(process.env.NODE_ENV!=='test')throw Error('Test injection is disabled.');testTransport=transport}
const request=(...args)=>(testTransport||firebaseRequest)(...args);
export async function read(fn){if(context.getStore())return fn();const result=await request('atolls');const root=result.value?{...result.value,state:normalizeState(result.value.state)}:null;return context.run({root,write:false},fn)}
export function state(){const store=context.getStore();if(!store)throw Error('Use a read or transaction context.');return store.root?.state||emptyState()}
function writable(){const store=context.getStore();if(!store?.write)throw Error('Writes require a transaction.');if(!store.root)store.root={state:emptyState()};return store.root.state}
export async function transaction(fn){
  if(context.getStore()?.write)return fn();
  const deadline=Date.now()+20000;
  for(let attempt=0;attempt<5&&Date.now()<deadline;attempt++){
    const result=await request('atolls',{withEtag:true});
    if(!result.etag)throw Object.assign(new Error('Firebase did not return the transaction ETag.'),{status:503});
    const root=structuredClone(result.value);if(root)root.state=normalizeState(root.state);const store={root,write:true};
    const output=await context.run(store,fn);
    store.root ||= {state:emptyState()};store.root.revision=randomUUID();
    const saved=await request('atolls',{method:'PUT',value:store.root,etag:result.etag});
    if(!saved.conflict)return output;
    await new Promise(resolve=>setTimeout(resolve,20*(attempt+1)));
  }
  throw Object.assign(new Error('Another update is in progress. Please try again.'),{status:409});
}
export async function rows(name){return read(()=>Object.values(state()[name]||{}).map(row=>({...row})))}
export async function get(name,id){return read(()=>{const value=state()[name]?.[String(id)];return value?{...value}:undefined})}
export async function insert(name,data,key){return transaction(()=>{
  const s=writable();if(!COLLECTIONS.includes(name))throw Error('Unknown collection.');
  if(key===undefined){const max=Math.max(0,...Object.values(s[name]).map(row=>Number(row.id)||0),s.meta.counters[name]||0);key=max+1;s.meta.counters[name]=key;data={id:key,...data}}
  if(s[name][String(key)])throw Object.assign(new Error('Record already exists.'),{status:409});
  const row={created_at:timestamp(),...data};s[name][String(key)]=row;return row;
})}
export async function update(name,id,patch){return transaction(()=>{const s=writable();if(!s[name]?.[String(id)])return false;s[name][String(id)]={...s[name][String(id)],...patch};return true})}
export async function removeWhere(name,predicate){return transaction(()=>{const s=writable();let count=0;for(const [key,row]of Object.entries(s[name]))if(predicate(row)){delete s[name][key];count++}return count})}
export async function initializeSchema(){return transaction(async()=>{
 const s=writable();if(s.meta.initialized)return;
 for(const role of SYSTEM_ROLES)await insert('roles',{...role,is_system:true});
 s.meta.initialized=true;s.meta.schemaVersion=1;
})}
export async function audit(actor,type,detail){return insert('logs',{actor_id:actor,type,detail})}
export async function queueNotification(employee,subject,body){if(employee)return insert('notifications',{employee_id:employee,subject,body,is_read:0,email_status:'Queued',attempts:0})}
export async function importState(imported){return transaction(()=>{const store=context.getStore();if(store.root)throw Object.assign(new Error('Firebase namespace /atolls is not empty. Import refused; no data was overwritten.'),{status:409});store.root={state:normalizeState(imported)};store.root.state.meta.initialized=true})}
export function closeDatabase(){}
