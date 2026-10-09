export class ApiError extends Error{constructor(public status:number,message:string){super(message)}}
export async function api<T=unknown>(path:string,options:RequestInit={}):Promise<T>{
  const response=await fetch('/api/'+path,{...options,credentials:'same-origin',headers:{...(options.body instanceof FormData?{}:{'content-type':'application/json'}),...options.headers},cache:'no-store'});
  const data=await response.json();if(!response.ok){if(response.status===401&&!path.startsWith('auth/'))window.dispatchEvent(new Event('reador:unauthorized'));throw new ApiError(response.status,data.error||'请求失败，请重试')}return data;
}
export const post=<T=unknown>(path:string,data:unknown={})=>api<T>(path,{method:'POST',body:JSON.stringify(data)});
export const put=<T=unknown>(path:string,data:unknown)=>api<T>(path,{method:'PUT',body:JSON.stringify(data)});
export const uid=()=>crypto.randomUUID();
export const errorText=(error:unknown)=>error instanceof Error?error.message:'操作失败，请重试';
