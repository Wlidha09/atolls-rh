'use client';
import {useEffect, useState} from 'react';
import {readJsonResponse} from '../lib/http-client.js';
const months = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const metrics = [['Total Days in Month','totalDays',''],['Weekends','weekends','weekend'],['Public Holidays','publicHolidays','holiday'],['Approved Leave Days','approvedLeave','leave']];
function Calculator(){return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="5" y="2" width="14" height="20" rx="2"/><path d="M8 6h8M8 10h2m4 0h2M8 14h2m4 0h2M8 18h2m4 0h2"/></svg>}
export default function WorkTickets({me}) {
  const now = new Date();
  const [year,setYear]=useState(now.getFullYear()),[month,setMonth]=useState(now.getMonth()+1),[employeeId,setEmployeeId]=useState(me.id),[report,setReport]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[query,setQuery]=useState(''),[retry,setRetry]=useState(0);
  useEffect(()=>{
    const controller = new AbortController();
    setLoading(true);setError('');setReport(null);
    (async()=>{try{
      const response=await fetch(`/api/work-days?year=${year}&month=${month}`,{cache:'no-store',signal:controller.signal});
      const value=await readJsonResponse(response);
      if(!response.ok)throw Error(value.error);
      if(!controller.signal.aborted)setReport(value);
    }catch(error){if(!controller.signal.aborted)setError(error.message)}finally{if(!controller.signal.aborted)setLoading(false)}})();
    return ()=>controller.abort();
  },[year,month,retry]);
  const selected=report?.employees.find(employee=>employee.id===Number(employeeId))||report?.employees[0];
  const filtered=report?.employees.filter(employee=>`${employee.name} ${employee.title}`.toLowerCase().includes(query.toLowerCase()))||[];
  const total=filtered.reduce((sum,employee)=>sum+employee.netWorkedDays,0);
  const label=`${months[month-1]} ${year}`;
  return <section className="work-days-page">
    <div className="work-days-filters">
      {report?.organization?<label>Employee<select aria-label="Work days employee" value={selected?.id||''} onChange={event=>setEmployeeId(Number(event.target.value))}>{report.employees.map(employee=><option value={employee.id} key={employee.id}>{employee.name}{employee.active?'':' · Inactive'}</option>)}</select></label>:<div className="work-days-person">{me.name}</div>}
      <label>Month<select aria-label="Work days month" value={month} onChange={event=>setMonth(Number(event.target.value))}>{months.map((name,index)=><option value={index+1} key={name}>{name}</option>)}</select></label>
      <label>Year<select aria-label="Work days year" value={year} onChange={event=>setYear(Number(event.target.value))}>{Array.from({length:131},(_,index)=>1970+index).map(value=><option key={value}>{value}</option>)}</select></label>
    </div>
    {loading&&<p className="work-days-message" role="status">Calculating work days…</p>}
    {error&&<div className="error" role="alert">{error} <button type="button" className="link" onClick={()=>setRetry(value=>value+1)}>Retry</button></div>}
    {!loading&&selected&&<>
      <article className="work-days-card" aria-label="Employee work days">
        <div className="work-days-card-heading"><span className="work-days-icon"><Calculator/></span><div><h2>{selected.name}</h2><p>{label}</p></div></div>
        <dl>{metrics.map(([name,key,color])=><div className="work-days-line" key={key}><dt>{name}</dt><dd className={color}>{key==='totalDays'?'':'−'}{selected[key]}</dd></div>)}
        <div className="work-days-net"><dt>Net Worked Days</dt><dd>{selected.netWorkedDays}</dd></div></dl>
      </article>
      <div className="work-days-formula">Formula: Total Days ({selected.totalDays}) − Weekends ({selected.weekends}) − Public Holidays ({selected.publicHolidays}) − Approved Leave ({selected.approvedLeave}) = <b>{selected.netWorkedDays}</b> net days</div>
      <p className="work-days-note">Full-month calendar calculation, based on approved leave and all holidays configured in Availability & Holidays. Saturdays and Sundays are weekends. Overlapping days are deducted once. Office-day preferences do not reduce working days. This is a calendar estimate, including future days, rather than an attendance record.</p>
      {report.organization&&<section className="card work-days-summary"><div className="card-head"><div><h2>All employees</h2><p className="sub">{label} · {filtered.length} employees · <b>{total} net days</b></p></div><input className="search-field" aria-label="Search work days employees" placeholder="Search employees…" value={query} onChange={event=>setQuery(event.target.value)}/></div>
        <div className="table-wrap"><table><thead><tr>{['Employee','Status','Days in month','Weekends','Public holidays','Approved leave','Net days'].map(name=><th key={name}>{name}</th>)}</tr></thead><tbody>{filtered.map(employee=><tr key={employee.id} className={selected.id===employee.id?'work-days-selected':''}><td><button className="link" onClick={()=>setEmployeeId(employee.id)}>{employee.name}</button><small>{employee.title}</small></td><td>{employee.active?'Active':'Inactive'}</td><td>{employee.totalDays}</td><td>{employee.weekends}</td><td>{employee.publicHolidays}</td><td>{employee.approvedLeave}</td><td><b>{employee.netWorkedDays}</b></td></tr>)}</tbody>{!!filtered.length&&<tfoot><tr><th colSpan={6}>Total for listed employees</th><td><b>{total}</b></td></tr></tfoot>}</table></div>
        {!filtered.length&&<p className="work-days-message">No matching employees.</p>}
      </section>}
    </>}
  </section>;
}
