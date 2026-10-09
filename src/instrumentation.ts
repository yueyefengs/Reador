export async function register(){if(process.env.NEXT_RUNTIME==='nodejs'){const {startWorker}=await import('./modules/jobs/worker');startWorker()}}
