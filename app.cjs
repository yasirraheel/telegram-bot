// LiteSpeed loads its startup file through CommonJS require().
import('./server.js').then(({ startServer }) => startServer()).catch(() => {
  console.error('Telegram bot startup failed. Check runtime and configuration.');
  process.exit(1);
});
