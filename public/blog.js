const systemTheme = window.matchMedia('(prefers-color-scheme: light)');
function applyTheme(theme) {
 document.body.classList.toggle('light',theme === 'light');
 document.querySelector('meta[name="theme-color"]')?.setAttribute('content',theme === 'light' ? '#f0f3fa' : '#131722');
}
function savedTheme() { try { return localStorage.getItem('elite-theme'); } catch { return null; } }
applyTheme(savedTheme() || (systemTheme.matches ? 'light' : 'dark'));
document.querySelector('[data-blog-theme]')?.addEventListener('click',() => {
 const theme = document.body.classList.contains('light') ? 'dark' : 'light';
 applyTheme(theme);
 try { localStorage.setItem('elite-theme',theme); } catch {}
});
systemTheme.addEventListener('change',event => { if(!savedTheme()) applyTheme(event.matches ? 'light' : 'dark'); });
document.addEventListener('click',event => {
 if(event.target.closest('a[href]') || !event.target.closest('.public-menu')) document.querySelectorAll('.public-menu[open]').forEach(menu=>menu.removeAttribute('open'));
});
document.addEventListener('keydown',event => {
 if(event.key === 'Escape') document.querySelectorAll('.public-menu[open]').forEach(menu=>{ menu.removeAttribute('open'); menu.querySelector('summary')?.focus(); });
});
