// Socials: the text predictor (web/apps/socials/socials-predict.js) and the account list's order.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readText, generateComment, generateReply, intentOf, emojisIn } from '../web/apps/socials/socials-predict.js';
import { emptyState, addAccount, setOwner, sendMessage, markRead, switcherOrder } from '../web/apps/socials/socials-core.js';

const seq = (...v) => { let i = 0; return () => v[i++ % v.length]; };

test('a caption read for its topics, tags and emoji', () => {
  const r = readText('Golden hour at the beach 🌅🌊 #summer');
  assert.ok(r.topics.map((t) => t.id).includes('beach')); assert.ok(r.tags.includes('summer'));
  assert.deepEqual(emojisIn('so good 🍕🍕 yes 🎉'), ['🍕', '🎉']);
});

test('comments: never empty, varied, and on topic when the caption has one', () => {
  for (let i = 0; i < 40; i++) {
    const c = generateComment('Pizza night with the best crew 🍕', { rand: seq(i / 40, 0.3, 0.7, 0.1) });
    assert.ok(c.trim().length > 1);
  }
  const seen = new Set(); for (let i = 0; i < 30; i++) seen.add(generateComment('my dog at the park 🐶'));
  assert.ok(seen.size > 3);
  const c = generateComment('', { rand: () => 0.5 }); assert.ok(c.trim().length > 1);
  // (Avoided: comments already there.)
  const first = generateComment('sunset 🌅', { rand: () => 0 });
  for (let i = 0; i < 10; i++) assert.notEqual(generateComment('sunset 🌅', { avoid: [first] }), first);
});

test('replies answer what was said', () => {
  assert.equal(intentOf('thank you so much!'), 'thanks');
  assert.equal(intentOf('how are you?'), 'howareyou');
  assert.equal(intentOf('want to get dinner tomorrow?'), 'plan');
  for (const m of ['hey', 'lol 😂', 'are you coming?', 'I miss you ❤️', 'ok', '']) assert.ok(generateReply(m).trim().length > 0);
});

test('the account list: Owner first, then unread (most, then latest), then last used, then oldest', () => {
  const s = emptyState();
  const a = addAccount(s, { handle: 'a' }); const b = addAccount(s, { handle: 'b' }); const c = addAccount(s, { handle: 'c' }); const d = addAccount(s, { handle: 'd' });
  setOwner(s, a.id);
  a.at = 1; b.at = 2; c.at = 3; d.at = 4;
  assert.deepEqual(switcherOrder(s).map((x) => x.handle), ['a', 'b', 'c', 'd']);
  assert.deepEqual(switcherOrder(s, { [d.id]: 50, [c.id]: 40 }).map((x) => x.handle), ['a', 'd', 'c', 'b']);
  // (b has one unread, c has two: c then b, ahead of the latest used.)
  const m1 = sendMessage(s, a.id, b.id, 'hi'); m1.at = 100;
  const m2 = sendMessage(s, a.id, c.id, 'hi'); m2.at = 90; const m3 = sendMessage(s, d.id, c.id, 'yo'); m3.at = 95;
  assert.deepEqual(switcherOrder(s, { [d.id]: 50 }).map((x) => x.handle), ['a', 'c', 'b', 'd']);
  markRead(s, c.id, a.id, 1000); markRead(s, c.id, d.id, 1000);
  assert.deepEqual(switcherOrder(s, { [d.id]: 50 }).map((x) => x.handle), ['a', 'b', 'd', 'c']);
});

test('accounts: a friend or a celebrity (kept, changed, read back)', async () => {
  const { emptyState, addAccount, editAccount, normalize } = await import('../web/apps/socials/socials-core.js');
  const s = emptyState();
  const o = addAccount(s, { handle: 'me' }); const f = addAccount(s, { handle: 'pal' }); const c = addAccount(s, { handle: 'star', kind: 'celebrity' });
  assert.equal(f.kind, 'friend'); assert.equal(c.kind, 'celebrity'); assert.equal(o.owner, true);
  editAccount(s, f.id, { kind: 'celebrity' }); assert.equal(f.kind, 'celebrity');
  editAccount(s, f.id, { kind: 'nonsense' }); assert.equal(f.kind, 'friend');
  const back = normalize(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(back.accounts.map((a) => a.kind), ['friend', 'friend', 'celebrity']);
  assert.equal(normalize({ accounts: [{ id: 'x', handle: 'old' }] }).accounts[0].kind, 'friend', 'older accounts: friends');
});

test('comments made for the caption: its places, things, numbers, question, hashtags and people', async () => {
  const { generateComments, placesIn, thingsIn, numbersIn, asks } = await import('../web/apps/socials/socials-predict.js');
  assert.deepEqual([...placesIn('Sunset in Denver, then New York!')].sort(), ['Denver', 'New York']);
  assert.ok(placesIn('Weekend in Tokyo').includes('Tokyo')); assert.deepEqual(placesIn('Pizza at home'), []);
  assert.deepEqual(thingsIn('Finally got my new bike and the best helmet'), ['bike', 'helmet']);
  assert.deepEqual(numbersIn('Turning 21 today'), { age: 21 }); assert.equal(numbersIn('our 10th anniversary').years, 10); assert.equal(numbersIn('Ran a 5k this morning').km, '5');
  assert.ok(asks('Pizza or tacos tonight?')); assert.ok(!asks('Pizza night'));
  const all = (cap, o = {}) => { const out = []; for (let i = 0; i < 60; i++) out.push(...generateComments(cap, 5, o)); return out.join('\n'); };
  assert.match(all('Sunset in Denver #goldenhour'), /Denver/); assert.match(all('Sunset in Denver #goldenhour'), /#goldenhour/);
  assert.match(all('Turning 21 today 🎉'), /21st/);
  assert.match(all('Pizza or tacos tonight?'), /Tacos|Pizza|tacos|pizza/);
  assert.match(all('Finally got my new bike'), /bike/);
  assert.match(all('Beach day', { tagged: ['sam'] }), /@sam/);
  assert.match(all('Beach day', { tagged: ['sam'], as: ['sam', 'sam', 'sam', 'sam', 'sam'] }), /tag|there|with you/);
  assert.doesNotMatch(all('Beach day', { tagged: ['sam'], as: ['sam', 'sam', 'sam', 'sam', 'sam'] }), /@sam/, 'not to itself');
  // A batch: all different.
  for (let i = 0; i < 20; i++) { const b = generateComments('Golden hour at the beach 🌅 #summer', 5); assert.equal(new Set(b).size, 5); }
});

test('chat replies from the whole conversation: answers, asked back, plans followed up, posts, goodbyes, never the same twice', async () => {
  const { chatReply, plansIn, moodOf } = await import('../web/apps/socials/socials-chat.js');
  const T = Date.parse('2026-11-20T18:00:00'); const H = 3600000;
  const many = (h, n = 30, o = {}) => Array.from({ length: n }, () => chatReply(h, { now: h.at(-1).at + 5000, ...o }));
  const asked = [{ mine: true, text: 'hey', at: T }, { mine: false, text: 'Hey! How are you?', at: T + 1000 }];
  for (const r of many([...asked, { mine: true, text: 'Great, best day ever', at: T + 2000 }])) assert.match(r, /love|yay|nice|great|glad|awesome|happy|amazing|best|good|so fun/i);
  for (const r of many([...asked, { mine: true, text: 'not great, so tired', at: T + 2000 }])) assert.match(r, /no|sorry|rough|hug|happened|hard|okay|talk|ugh|aw/i);
  for (const r of many([{ mine: true, text: 'good, you?', at: T }])) assert.match(r, /good|great|not bad|chilling|gym|dinner|movie|home|coffee|working|cleaning|walk|phone/i);
  // A plan mentioned, the next day: how was it?
  const plan = [{ mine: true, text: 'Going to a concert tonight!', at: T }, { mine: false, text: 'Ooh fun!', at: T + 1000 }, { mine: true, text: 'hey', at: T + 20 * H }];
  assert.ok(many(plan).some((r) => /How was the concert/.test(r)));
  assert.ok(!many([{ mine: true, text: 'Going to a concert tonight!', at: T }]).some((r) => /How was/.test(r)), 'not before it\'s happened');
  assert.deepEqual(plansIn([{ mine: true, text: 'heading to Denver tomorrow', at: T }]).map((p) => [p.what, p.when]), [['Denver', 'tomorrow']]);
  // A shared post: about the post.
  for (const r of many([{ mine: true, text: '', post: { caption: 'Pizza night', scene: { labels: [['pizza', 0.9]] } }, at: T }], 10)) assert.ok(r.length > 3);
  for (const r of many([{ mine: true, text: 'ok gotta go, night!', at: T }], 10)) assert.match(r, /night|bye|talk soon|ttyl|sleep|see you/i);
  // Never what it said before in the chat.
  const before = [{ mine: true, text: 'thanks!', at: T }, { mine: false, text: 'Anytime! 😊', at: T + 1 }, { mine: true, text: 'thanks!', at: T + 2 }];
  for (const r of many(before)) assert.notEqual(r, 'Anytime! 😊');
  assert.equal(moodOf('so good!!'), 'pos'); assert.equal(moodOf('ugh, awful'), 'neg'); assert.equal(moodOf('not bad'), 'pos'); assert.equal(moodOf('ok'), 'neutral');
});

test('chat replies say their own words back and build on them, not stock lines', async () => {
  const { chatReply, flip, phraseIn } = await import('../web/apps/socials/socials-chat.js');
  assert.equal(flip('I got my license!'), 'you got your license'); assert.equal(flip('we were late'), 'you guys were late'); assert.equal(flip('do you like it'), null);
  assert.deepEqual([phraseIn('we tried the new taco truck').phrase, phraseIn('I had the best pizza').phrase, phraseIn('amazing, best show ever').phrase], ['the new taco truck', 'the best pizza', 'best show ever']);
  const many = (h, n = 40) => { const hist = (Array.isArray(h) ? h : [h]).map((x, i) => (typeof x === 'string' ? { mine: true, text: x, at: 1000 + i } : { ...x, at: 1000 + i })); return Array.from({ length: n }, () => chatReply(hist, { now: 99999 })); };
  const share = (list, re) => list.filter((r) => re.test(r)).length / list.length;
  assert.ok(share(many('I got the job!!'), /You got the job\?!/) > 0.7, 'news said back');
  assert.ok(share(many('ugh I failed my exam'), /You failed your exam\?!.*(no|sorry|worst)/i) > 0.7);
  assert.ok(share(many('the weather is so nice today'), /the weather is so nice/i) > 0.7, 'agreeing in their words');
  assert.ok(share(many('im so tired'), /^So tired\?/) > 0.7);
  assert.ok(share(many('heading to Denver tomorrow'), /^Denver tomorrow\?!/) > 0.7);
  assert.ok(share(many([{ mine: false, text: 'How was the concert?' }, 'amazing, best show ever']), /Best show ever\?!/) > 0.6, 'the answer\'s own words');
  assert.ok(share(many('my dog learned a new trick'), /Your dog learned a new trick\?!/) > 0.6);
  for (const r of many('we tried the new taco truck')) assert.doesNotMatch(r, /Congrats|How's a /);
});

test('voices and styles: each account its own voice (always the same); replies lean toward how the Owner texts; two messages sometimes; comments in their commenter\'s voice', async () => {
  const { personaOf, voice, styleOf, PERSONAS } = await import('../web/apps/socials/socials-style.js');
  const { chatReplyStyled } = await import('../web/apps/socials/socials-chat.js');
  const { generateComments } = await import('../web/apps/socials/socials-predict.js');
  assert.equal(personaOf('amy'), personaOf('amy')); assert.ok(PERSONAS.includes(personaOf('zed')));
  assert.ok(['hype', 'warm', 'classic'].includes(personaOf('anyone', 'celebrity')));
  const seen = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l'].map((h) => personaOf(h))); assert.ok(seen.size >= 3, 'different accounts, different voices');
  // How someone texts.
  const st = styleOf(['omg i got the job lol', 'sooo excited', 'we should celebrate fr']);
  assert.equal(st.lower, true); assert.ok(st.emoji < 0.25); assert.ok(st.slang.includes('lol') && st.slang.includes('fr')); assert.equal(st.stretch, true);
  assert.equal(styleOf([]), null);
  // The voices.
  assert.match(voice('Love that! 😍 Where from?', { persona: 'chill', rand: () => 0.9 }), /^love that! 😍 where from\?$/);
  assert.match(voice('So fun!', { persona: 'hype', rand: () => 0.1 }), /!!/);
  assert.match(voice('Congrats', { persona: 'warm', rand: () => 0.1 }), /[💛🥹❤️🥰]/u);
  assert.equal(voice('Nice! 😍 Tell me more', { style: { lower: true, emoji: 0, bang: 1, short: false, slang: [], stretch: false }, rand: () => 0.1 }), 'nice! tell me more', 'lowercase, no emojis, like them');
  // A lowercase, no-emoji texter gets replies that way, from every voice.
  let lowerCount = 0; let emojiCount = 0; let two = 0;
  for (const persona of PERSONAS) for (let i = 0; i < 12; i++) {
    const r = chatReplyStyled([{ mine: true, text: 'i just had the best tacos', at: 1 }, { mine: false, text: 'Ooh nice!', at: 2 }, { mine: true, text: 'ya they were so good', at: 3 }], { persona, now: 9 });
    if (/^[\p{Ll}]/u.test(r)) lowerCount++; if (/\p{Extended_Pictographic}/u.test(r)) emojiCount++; if (r.includes('\n')) two++;
  }
  assert.ok(lowerCount / 60 > 0.7, `lowercase like them (${lowerCount}/60)`); assert.ok(emojiCount / 60 < 0.6, `mostly no emojis like them (${emojiCount}/60)`); assert.ok(two > 0, 'two messages now and then');
  // Comments: in voices of their own, and lively.
  const c = []; for (let i = 0; i < 20; i++) c.push(...generateComments('Gala night', 3, { photo: { labels: [['gown', 0.6]], people: 1, outfit: { color: 'red' } }, as: ['bo', 'cy', 'dee'] }));
  assert.ok(new Set(c).size > 25, 'varied'); assert.ok(c.some((x) => /red dress/.test(x)));
});

test('language levels: Tame never swears (cleaned), Casual only mild, Spicy and Adult swear; Adult adds crude asides; AI replies checked before they\'re sent', async () => {
  const { spice, cleanWords, CONTENT_LEVELS } = await import('../web/apps/socials/socials-style.js');
  const { checkReply } = await import('../web/apps/socials/socials-ai.js');
  assert.equal(CONTENT_LEVELS.length, 4);
  assert.equal(cleanWords('holy shit this is fucking good, damn', 0), 'holy cow this is really good, dang');
  assert.equal(cleanWords('holy shit this is fucking good, damn', 1), 'holy cow this is freaking good, damn');
  assert.equal(cleanWords('holy shit this is fucking good, damn', 2), 'holy shit this is fucking good, damn');
  const STRONG = /\b(fuck\w*|shit\w*|ass|bitch|goddamn)\b/i; const ANY = /\b(fuck\w*|shit\w*|damn|hell|goddamn)\b/i;
  const run = (lvl, n = 200) => Array.from({ length: n }, () => spice('Love that! So good 😍', lvl, { mood: 'pos', persona: 'hype' }));
  for (const t of run(0)) assert.doesNotMatch(t, ANY);
  for (const t of run(1)) assert.doesNotMatch(t, STRONG);
  assert.ok(run(1).some((t) => ANY.test(t)), 'Casual: damn now and then');
  assert.ok(run(2).some((t) => STRONG.test(t)), 'Spicy: swears');
  assert.ok(run(3, 400).some((t) => /hot|sexy/.test(t)), 'Adult: flirty asides');
  // The AI's text: one message, the right length, on topic, a friend's (not an assistant's), at the level.
  assert.equal(checkReply('omg you got the job?? thats huge, when do you start', { said: 'i got the job!!', draft: 'You got the job?! How do you feel?' }), 'omg you got the job?? thats huge, when do you start');
  assert.equal(checkReply('I\'m here to help you with anything you need today, just let me know!', { said: 'ugh bad day' }), null);
  assert.equal(checkReply('Here are some tips for skiing: wear layers and stay hydrated always', { said: 'going skiing' }), null);
  assert.equal(checkReply('<think>hmm</think>lasagna from scratch?! okay chef\nsecond line', { said: 'i made lasagna' }), 'lasagna from scratch?! okay chef');
  assert.equal(checkReply('jess: wait what?? no way', { said: 'guess what', name: 'jess' }), 'wait what?? no way');
  assert.equal(checkReply('the weather on mars has been interesting lately with all these dust storms happening', { said: 'i got a puppy', draft: 'A puppy?! Send pics' }), null, 'off topic');
  assert.equal(checkReply('holy shit you got the job', { said: 'i got the job', level: 0 }), 'holy cow you got the job', 'cleaned to the level');
});

test('the AI worker\'s network fence: the app\'s own files; the model\'s files only while downloading; nothing carrying anything, ever', async () => {
  const { allowRequest, guardedFetch } = await import('../web/apps/socials/socials-ai-guard.js');
  const origin = 'https://example.github.io'; const model = 'onnx-community/Qwen2.5-1.5B-Instruct';
  const ok = (o) => allowRequest({ origin, model, remote: true, ...o }).ok;
  assert.ok(ok({ url: `${origin}/commandcenter/web/vendor/transformers/ort-wasm-simd-threaded.jsep.wasm` }), 'its own files');
  assert.ok(ok({ url: `https://huggingface.co/${model}/resolve/main/onnx/model_q4f16.onnx` }), 'the model, while downloading');
  assert.ok(ok({ url: 'https://us.aws.cdn.hf.co/xet-bridge-us/abc' }), 'its file servers');
  assert.ok(!allowRequest({ origin, model, remote: false, url: `https://huggingface.co/${model}/resolve/main/config.json` }).ok, 'downloaded: nothing remote');
  assert.ok(!ok({ url: 'https://api.example.com/v1/chat', method: 'POST', hasBody: true }), 'no posting anything anywhere');
  assert.ok(!ok({ url: `https://huggingface.co/${model}/resolve/main/x.json`, method: 'POST', hasBody: true }));
  assert.ok(!ok({ url: 'https://evil.com/collect?msg=hello' }), 'no other hosts');
  assert.ok(!ok({ url: 'https://huggingface.co/api/whoami' }), 'not other Hugging Face pages');
  assert.ok(!ok({ url: `https://huggingface.co/${model}/resolve/main/config.json?text=my+secret` }), 'no query strings');
  assert.ok(!ok({ url: 'http://huggingface.co/x' }), 'https only');
  // The wrapped fetch: refused without reaching the network.
  let reached = 0; const f = guardedFetch(async () => { reached++; return new Response('ok'); }, { origin, model, remote: () => false });
  await assert.rejects(f('https://evil.com/x'), /Blocked/); await assert.rejects(f(`https://huggingface.co/${model}/resolve/main/a`), /Blocked/);
  assert.equal(reached, 0); await f(`${origin}/a.js`); assert.equal(reached, 1);
});

test('on-device AI for comments and captions: what the photo shows described for it; its lines checked; the engine\'s used when it isn\'t ready', async () => {
  const { describeScene } = await import('../web/apps/socials/socials-predict.js');
  const { checkLine, aiComments, aiCaption } = await import('../web/apps/socials/socials-ai.js');
  const d = describeScene({ labels: [['pizza', 0.8]], faces: 2, people: 2, bg: ['sky'], place: 'Denver', hour: 22 });
  assert.match(d, /2 people/); assert.match(d, /pizza/); assert.match(d, /in Denver/); assert.match(d, /at night/);
  assert.equal(describeScene(null), '');
  assert.equal(checkLine('1. that pizza looks unreal, save me a slice', { about: d }), 'that pizza looks unreal, save me a slice');
  assert.equal(checkLine('The image shows two people eating pizza', { about: d }), null, 'not a description');
  assert.equal(checkLine('"so good #pizza" 😋', { about: d }), 'so good 😋', 'hashtags at the end let go, and quotes round it');
  assert.equal(checkLine('#pizza so good', { about: d }), null, 'no hashtags in a comment');
  assert.equal(checkLine('**Pizza By Two Friends In Denver**', { about: d }), null, 'not a title');
  assert.equal(checkLine('pizza vibes 大海的风情', { about: d }), null);
  assert.equal(checkLine('Totally unrelated words about my landlord and rent going up', { about: d }), null, 'about the post');
  assert.equal(checkLine('this is fucking great', { level: 0 }).includes('fuck'), false, 'the language level kept');
  assert.deepEqual(await aiComments({ as: [{ handle: 'bo' }], drafts: ['Love it!'], scene: d }), ['Love it!'], 'not loaded: the engine\'s');
  assert.equal(await aiCaption({ scene: d, draft: 'Pizza night' }), null);
});

test('replies to comments: thanks for praise, answers (where from the caption), banter for a tease, something about what they named; threads keep one level', async () => {
  const { commentReply } = await import('../web/apps/socials/socials-chat.js');
  const { emptyState, addAccount, addPost, addComment } = await import('../web/apps/socials/socials-core.js');
  const r = (c) => commentReply(c, { commenter: 'amy', caption: 'Pizza night in Denver', rand: () => 0.9 });
  assert.match(r('where is this?? looks amazing'), /Denver/);
  assert.match(r('omg you look stunning!! 😍🔥'), /thank|sweet|day|stop/i);
  assert.match(r('so jealous, invite me next time'), /next time|jealous|make it up/i);
  assert.match(r('that pizza looks unreal'), /pizza/i);
  assert.match(r('congrats grad!!'), /thank|means|without you/i);
  assert.match(commentReply('love it', { commenter: 'amy', rand: () => 0.1 }), /^@amy /, 'the commenter @mentioned now and then');
  const s = emptyState(); const a = addAccount(s, { handle: 'a' }); const b = addAccount(s, { handle: 'b' });
  const p = addPost(s, a.id, { image: new Blob(['x']) });
  const c1 = addComment(s, p.id, b.id, 'nice'); const c2 = addComment(s, p.id, a.id, 'thanks!', { re: c1.id }); const c3 = addComment(s, p.id, b.id, 'np', { re: c2.id });
  assert.equal(c2.re, c1.id); assert.equal(c3.re, c1.id, 'a reply to a reply: under the same comment');
});

test('an account\'s own voice and what it\'s into: chosen in its profile (else its own from its handle), kept, used for its words and by the AI', async () => {
  const { personaFor, personaOf, aboutOf } = await import('../web/apps/socials/socials-style.js');
  const { emptyState, addAccount, editAccount, normalize } = await import('../web/apps/socials/socials-core.js');
  const { generateComments } = await import('../web/apps/socials/socials-predict.js');
  const { readFile } = await import('node:fs/promises');
  const s = emptyState(); const a = addAccount(s, { handle: 'kai', bio: 'Surf and coffee' });
  assert.equal(personaFor(a), personaOf('kai'), 'its own to start');
  editAccount(s, a.id, { voice: 'chill', interests: '  surfing, dry humor ' });
  assert.equal(personaFor(a), 'chill'); assert.equal(a.interests, 'surfing, dry humor');
  assert.equal(aboutOf(a), 'Bio: Surf and coffee. Into: surfing, dry humor');
  const back = normalize(JSON.parse(JSON.stringify(s))).accounts[0]; assert.equal(back.voice, 'chill'); assert.equal(back.interests, 'surfing, dry humor');
  editAccount(s, a.id, { voice: null, interests: '' }); assert.equal(a.voice, undefined); assert.equal(a.interests, undefined, 'back to its own');
  editAccount(s, a.id, { voice: 'shouty' }); assert.equal(a.voice, undefined, 'only the five');
  // (Chill: lowercase starts, one emoji at most.)
  const out = generateComments('Beach day', 6, { photo: { labels: [['seashore', 0.8]], bg: ['sand', 'water'] }, personas: Array(6).fill('chill'), rand: (() => { let i = 0; return () => ((i++ * 0.37) % 1); })() });
  assert.ok(out.every((c) => !/^[A-Z]/.test(c)), `chill: ${out.join(' | ')}`);
  // Home-screen shortcuts in the manifest.
  const m = JSON.parse(await readFile(new URL('../web/manifest.webmanifest', import.meta.url), 'utf8'));
  assert.deepEqual(m.shortcuts.map((x) => x.url), ['./#/socials/new', './#/socials/inbox', './#/saved/search', './#/saved/scan']);
});
