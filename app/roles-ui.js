'use client';
import {useState} from 'react';
import {ACTIONS, FEATURES, emptyPermissions, hasPermission, roleScope} from '../lib/roles.js';

function Shield(){return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z"/></svg>}
export function RoleCards({roles,can,onEdit,onDelete}){
 return <section className="roles-page"><div className="roles-count">{roles.length} {roles.length===1?'role':'roles'}</div><div className="role-list">{roles.map(role=><article className="role-card" key={role.id}>
  <div className="role-card-heading"><span className="role-shield"><Shield/></span><div><h2>{role.name}</h2><p>{role.is_system?'System role':'Custom role'}<span className="role-scope">{role.scope==='global'?'Organization':role.scope==='team'?'Direct reports':'Personal'}</span></p></div>{<div className="role-card-actions">{can('roles','edit')&&<button type="button" className="link" onClick={()=>onEdit(role)}>Edit</button>}{can('roles','delete')&&<button type="button" className="link danger" onClick={()=>onDelete(role)}>Delete</button>}</div>}</div>
  <div className="permission-chips">{FEATURES.map(([key,label])=>{const actions=ACTIONS.filter(action=>role.permissions[key]?.[action]);return actions.length?<span className="permission-chip" key={key}>{label}: <b>{actions.join(', ')}</b></span>:null})}{!FEATURES.some(([key])=>ACTIONS.some(action=>role.permissions[key]?.[action]))&&<span className="sub">No module permissions assigned.</span>}</div>
 </article>)}</div></section>;
}

export function RoleForm({role,actor}){
 const [permissions,setPermissions]=useState(()=>role?.permissions||emptyPermissions());
 function toggle(key,action,checked){setPermissions(previous=>{const next={...previous,[key]:{...previous[key],[action]:checked}};if(action==='view'&&!checked)for(const verb of ACTIONS)next[key][verb]=false;if(action!=='view'&&checked)next[key].view=true;return next})}
 const rank={self:0,team:1,global:2};
 return <div className="role-form"><label className="field">Role Name<input name="name" required minLength={2} maxLength={50} defaultValue={role?.name||''} readOnly={!!role?.is_system} autoFocus/></label>
 <label className="field role-scope-field">Access scope<select name="scope" defaultValue={role?.scope||'self'}>{[['self','Personal'],['team','Direct reports'],['global','Entire organization']].filter(([scope])=>rank[scope]<=rank[roleScope(actor)]).map(([scope,label])=><option value={scope} key={scope}>{label}</option>)}</select></label>
 <input type="hidden" name="permissions" value={JSON.stringify(permissions)}/>
 <h3>Permissions Matrix</h3><div className="permission-table-wrap"><table className="permission-matrix"><thead><tr><th>Feature</th>{ACTIONS.map(action=><th key={action}>{action[0].toUpperCase()+action.slice(1)}</th>)}</tr></thead><tbody>{FEATURES.map(([key,label])=><tr key={key}><td>{label}</td>{ACTIONS.map(action=>{const allowed=hasPermission(actor,key,action);return <td key={action}><input type="checkbox" aria-label={`${label}: ${action}`} title={allowed?`${action} ${label}`:'You cannot grant a permission your own role does not have.'} checked={permissions[key][action]} disabled={!allowed} onChange={event=>toggle(key,action,event.target.checked)}/></td>})}</tr>)}</tbody></table></div>
 <p className="permission-note">Scope applies to leave approvals and work tickets. Organization management requires global scope. Existing module actions enforce these permissions on the server.</p></div>;
}
