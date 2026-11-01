// Next.js 서버가 뜰 때 한 번 실행된다.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const { startupTasks } = await import('./server/startup');
  void startupTasks();
}
