export class HttpError extends Error { constructor(status,message){super(message);this.status=status;} }
export function ensure(condition,status=403,message='Permission denied'){if(!condition)throw new HttpError(status,message);}
export function manages(actor,target){return actor.role==='RH' || (actor.role==='Owner' && target.supervisor_id===actor.id);}
export function canReview(actor,target){return actor.id!==target.id && manages(actor,target);}
export function workingDays(start,end){let days=0;for(let d=new Date(start+'T12:00:00Z');d<=new Date(end+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+1)){if(d.getUTCDay()!==0&&d.getUTCDay()!==6)days++;}return days;}
export function overlaps(a,b,c,d){return a<d && b>c;}
export function isConfiguredAdministrator(email, adminEmail) {
  return typeof email === 'string' && typeof adminEmail === 'string' && !!adminEmail.trim() && email.trim().toLowerCase() === adminEmail.trim().toLowerCase();
}
export function googleAllowed(profile, domain, adminEmail) {
  if (profile.email_verified !== true || typeof profile.email !== 'string') return false;
  if (isConfiguredAdministrator(profile.email, adminEmail)) return true;
  const normalizedDomain = domain?.trim().toLowerCase();
  return !!normalizedDomain && profile.hd === normalizedDomain && profile.email.toLowerCase().split('@')[1] === normalizedDomain;
}
export function googleHostedDomainHint(domain, adminEmail) {
  const companyDomain = domain?.trim().toLowerCase();
  if (adminEmail && adminEmail.trim().toLowerCase().split('@')[1] !== companyDomain) return undefined;
  return companyDomain;
}
