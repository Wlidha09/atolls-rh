import {SignJWT, importPKCS8} from 'jose';
let cachedToken, tokenPromise, keyPromise;
export function configuration(env=process.env) {
  const {FIREBASE_DATABASE_URL:databaseURL,FIREBASE_PROJECT_ID:projectId,FIREBASE_CLIENT_EMAIL:clientEmail,FIREBASE_PRIVATE_KEY:privateKey}=env;
  let url;
  try { url=new URL(databaseURL); } catch {}
  if (!url || url.protocol!=='https:' || !/\.(firebaseio\.com|firebasedatabase\.app)$/.test(url.hostname) || url.username || url.password || url.search || url.hash || !['','/'].includes(url.pathname) || !projectId || !clientEmail || !privateKey) {
    throw Object.assign(new Error('Configure FIREBASE_DATABASE_URL, FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY on the server.'),{status:503,code:'DATABASE_CONFIGURATION'});
  }
  return {databaseURL:url.origin,projectId,clientEmail,privateKey:privateKey.replaceAll('\\n','\n')};
}
async function signingKey() {const c=configuration();return keyPromise ||= importPKCS8(c.privateKey,'RS256').catch(error=>{keyPromise=null;throw error})}
async function accessToken() {
  if(cachedToken?.expires>Date.now()+60000)return cachedToken.value;
  if(tokenPromise)return tokenPromise;
  tokenPromise=(async()=>{
    const c=configuration();
    const assertion=await new SignJWT({scope:'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email'}).setProtectedHeader({alg:'RS256'}).setIssuer(c.clientEmail).setAudience('https://oauth2.googleapis.com/token').setIssuedAt().setExpirationTime('1h').sign(await signingKey());
    const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}),signal:AbortSignal.timeout(8000)});
    if(!response.ok)throw Object.assign(new Error('Firebase service-account authentication failed. Check the server key and account permissions.'),{status:503});
    const body=await response.json();if(!body.access_token)throw new Error('Firebase access token is missing.');
    cachedToken={value:body.access_token,expires:Date.now()+body.expires_in*1000};return body.access_token;
  })().finally(()=>{tokenPromise=null});return tokenPromise;
}
export async function firebaseRequest(path,{method='GET',value,etag,withEtag=false}={}) {
  const c=configuration();
  const response=await fetch(`${c.databaseURL}/${path}.json`,{method,headers:{Authorization:`Bearer ${await accessToken()}`,...(withEtag?{'X-Firebase-ETag':'true'}:{}),...(etag?{'if-match':etag}:{}),...(value===undefined?{}:{'Content-Type':'application/json'})},...(value===undefined?{}:{body:JSON.stringify(value)}),cache:'no-store',signal:AbortSignal.timeout(8000)});
  if(response.status===412)return {conflict:true};
  if(!response.ok)throw Object.assign(new Error(`Firebase database request failed (HTTP ${response.status}). Check database URL and service-account access.`),{status:503});
  return {value:await response.json(),etag:response.headers.get('etag')};
}
export async function realtimeCredentials(employee,sessionHash) {
  const c=configuration();
  if(!process.env.FIREBASE_WEB_API_KEY)throw Object.assign(new Error('Set FIREBASE_WEB_API_KEY to enable automatic updates.'),{status:503});
  const token=await new SignJWT({uid:`atolls-${employee.id}`,claims:{employee_id:employee.id,session_hash:sessionHash}}).setProtectedHeader({alg:'RS256'}).setIssuer(c.clientEmail).setSubject(c.clientEmail).setAudience('https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit').setIssuedAt().setExpirationTime('1h').sign(await signingKey());
  return {customToken:token,apiKey:process.env.FIREBASE_WEB_API_KEY,databaseURL:c.databaseURL};
}
