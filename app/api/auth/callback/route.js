import { cookies } from 'next/headers';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { createSession } from '../../../../lib/session.js';
import { acceptGoogleIdentity } from '../../../../lib/identity.js';
const jwks=createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
export const runtime='nodejs';
export async function GET(request){
 const redirect=error=>Response.redirect(new URL(error?'/?error='+error:'/',process.env.APP_URL));
 try{
 const jar=await cookies(),raw=jar.get('atolls_oauth')?.value;jar.delete('atolls_oauth');
 const url=new URL(request.url);if(!raw)return redirect('OAuth');
 const flow=JSON.parse(raw);if(url.searchParams.get('state')!==flow.state||!url.searchParams.get('code'))return redirect('OAuth');
 const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code:url.searchParams.get('code'),client_id:process.env.GOOGLE_CLIENT_ID,client_secret:process.env.GOOGLE_CLIENT_SECRET,redirect_uri:new URL('/api/auth/callback',process.env.APP_URL).href,grant_type:'authorization_code',code_verifier:flow.verifier}),signal:AbortSignal.timeout(15000)});
 if(!response.ok)return redirect('OAuth');const tokens=await response.json();
 const {payload}=await jwtVerify(tokens.id_token,jwks,{issuer:['https://accounts.google.com','accounts.google.com'],audience:process.env.GOOGLE_CLIENT_ID,algorithms:['RS256'],requiredClaims:['exp','iat','sub','email','email_verified','nonce']});
 if(payload.nonce!==flow.nonce)return redirect('OAuth');
 const employee=acceptGoogleIdentity(payload);
 await createSession(employee);return redirect();
 }catch(error){return redirect(['Inactive','Domain','Configuration'].includes(error.message)?error.message:'OAuth');}
}
