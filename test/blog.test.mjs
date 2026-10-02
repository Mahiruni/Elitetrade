import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { blogPosts } from '../src/blog-content.mjs';
import { renderBlogPage, wordCount } from '../src/blog.mjs';
import { createApplication } from '../src/app.mjs';
import { createSupabaseApplication } from '../src/supabase-app.mjs';
import { openDatabase } from '../src/database.mjs';

const origin = 'https://elitetradee.vercel.app';
const schemas = html => [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map(match => JSON.parse(match[1]));

test('the public library exposes ten original, complete guides and crawlable article links', () => {
  assert.equal(blogPosts.length,10);
  assert.equal(new Set(blogPosts.map(p=>p.slug)).size,10);
  assert.equal(new Set(blogPosts.map(p=>p.title)).size,10);
  const index = renderBlogPage('/blog');
  assert.equal(index.status,200);
  const sitemap = readFileSync(new URL('../public/sitemap.xml',import.meta.url),'utf8');
  for(const post of blogPosts) {
    assert.ok(wordCount(post)>=350,post.slug+' must contain at least 350 body words');
    const path = '/blog/'+post.slug;
    assert.ok(index.html.includes('href="'+path+'"'));
    assert.ok(sitemap.includes('<loc>'+origin+path+'</loc>'));
    const page = renderBlogPage(path);
    assert.equal(page.status,200);
    assert.ok(page.html.includes('<link rel="canonical" href="'+origin+path+'">'));
    assert.ok(page.html.includes('property="og:type" content="article"'));
    assert.ok(!page.html.includes('src="/app.js"'),'blog content must not be replaced by the SPA');
    const paragraphs = [...page.html.matchAll(/<p class="blog-content-paragraph">([\s\S]*?)<\/p>/g)];
    assert.equal(paragraphs.length,post.sections.length);
    assert.ok(paragraphs.every(m=>m[1].includes('href="/signup"')),'every content paragraph links to account creation');
    const [article,breadcrumb] = schemas(page.html);
    assert.equal(article['@type'],'BlogPosting');
    assert.equal(article.wordCount,wordCount(post));
    assert.equal(article.headline,post.title);
    assert.equal(article.mainEntityOfPage['@id'],origin+path);
    assert.equal(article.articleBody.includes(post.sections[0][1]),true);
    assert.equal(breadcrumb.itemListElement.at(-1).item,origin+path);
    assert.ok(post.hashtags.every(tag=>page.html.includes('#'+tag)));
    assert.ok(page.html.includes('https://trends.google.com/trends/explore?'));
  }
});

test('canonical redirects, unrelated routes and missing guides have distinct outcomes', () => {
  assert.equal(renderBlogPage('/'),null);
  assert.equal(renderBlogPage('/blogs'),null);
  assert.deepEqual(renderBlogPage('/blog/'),{status:308,location:'/blog'});
  const slug=blogPosts[0].slug;
  assert.deepEqual(renderBlogPage('/blog/'+slug+'/'),{status:308,location:'/blog/'+slug});
  const missing=renderBlogPage('/blog/unpublished-guide');
  assert.equal(missing.status,404);
  assert.ok(missing.html.includes('content="noindex,follow"'));
  assert.ok(missing.html.includes('href="/blog"'));
});

test('editorial text is escaped in HTML and cannot terminate structured data', () => {
  const post=blogPosts[0],original=post.sections[0][1];
  try {
    post.sections[0][1]='<script>alert("example")</script> & sample';
    const html=renderBlogPage('/blog/'+post.slug).html;
    assert.ok(html.includes('&lt;script&gt;alert(&quot;example&quot;)&lt;/script&gt; &amp; sample'));
    assert.ok(!html.includes('<script>alert("example")</script>'));
    assert.ok(schemas(html)[0].articleBody.includes(post.sections[0][1]));
  } finally { post.sections[0][1]=original; }
});

for(const backend of ['local','supabase']) {
  test(backend+' serves the full blog without authentication, including HEAD, assets and 404s', async t => {
    const db=backend==='local'?openDatabase(':memory:'):new Proxy({}, {get(){throw new Error('Public blog must not query account data');}});
    const options={db,key:randomBytes(32),env:{APP_ORIGIN:'http://localhost:3000'},gateway:null,telegram:null,mailer:null};
    const app=backend==='local'?createApplication(options):createSupabaseApplication(options);
    t.after(async()=>{await app.close();if(backend==='local')db.close();});
    await new Promise(resolve=>app.server.listen(0,'127.0.0.1',resolve));
    const base='http://127.0.0.1:'+app.server.address().port;
    for(const path of ['/blog',...blogPosts.map(p=>'/blog/'+p.slug)]) {
      const response=await fetch(base+path);
      assert.equal(response.status,200,path);
      assert.ok(response.headers.get('content-type').includes('text/html'));
      const html=await response.text();
      assert.ok(html.includes('<h1>'));
      assert.ok(html.includes('href="/signup"'));
    }
    const head=await fetch(base+'/blog/'+blogPosts[0].slug,{method:'HEAD'});
    assert.equal(head.status,200);
    assert.equal(await head.text(),'');
    assert.ok(head.headers.get('content-type').includes('text/html'));
    const redirect=await fetch(base+'/blog/',{redirect:'manual'});
    assert.equal(redirect.status,308);
    assert.equal(redirect.headers.get('location'),'/blog');
    const missing=await fetch(base+'/blog/missing');
    assert.equal(missing.status,404);
    assert.ok((await missing.text()).includes('noindex,follow'));
    for(const [path,type] of [['/blog.css','text/css'],['/blog.js','text/javascript']]) {
      const response=await fetch(base+path);
      assert.equal(response.status,200);
      assert.ok(response.headers.get('content-type').includes(type));
      assert.ok((await response.text()).length>100);
    }
    assert.equal((await fetch(base+'/blog',{method:'POST'})).status,405);
  });
}
