import { randomBytes, createHash } from 'node:crypto';
import { cookies } from 'next/headers';
import { cookieOptions } from '../../../../lib/session.js';
import { googleHostedDomainHint } from '../../../../lib/policy.js';
export const runtime='nodejs';
export async function GET(){
 if(!process.env.GOOGLE_CLIENT_ID||!process.env.GOOGLE_CLIENT_SECRET||!process.env.COMPANY_DOMAIN)return Response.redirect(new URL('/?error=Configuration',process.env.APP_URL||'http://localhost:3000'));
 const state=randomBytes(32).toString('hex'),nonce=randomBytes(32).toString('hex'),verifier=randomBytes(32).toString('base64url');
 const jar=await cookies();jar.set('atolls_oauth',JSON.stringify({state,nonce,verifier}),{...cookieOptions,maxAge:600});
 const hint=googleHostedDomainHint(process.env.COMPANY_DOMAIN,process.env.ADMIN_EMAIL);
 const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');url.search=new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID,redirect_uri:new URL('/api/auth/callback',process.env.APP_URL).href,response_type:'code',scope:'openid email profile',state,nonce,...(hint?{hd:hint}:{}),prompt:'select_account',code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}).toString();
 return Response.redirect(url);
}
