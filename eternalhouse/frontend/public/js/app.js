/* EternalHouse client — CSP-safe (no inline handlers, no HTML string injection). Light, passive, rAF-throttled. */
(function () {
  'use strict';
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var fine = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var csrf = ($('meta[name="csrf"]') || {}).content || '';

  function api(url, body) {
    return fetch(url, {
      method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: body === undefined ? undefined : JSON.stringify(body)
    }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) { var e = new Error(j.error || 'Request failed'); e.status = r.status; e.data = j; if (r.status === 401 && j.login) { location.href = j.login + '?next=' + encodeURIComponent(location.pathname + location.search); } throw e; } return j; }); });
  }

  /* intro curtain: first visit of a session only */
  var seen = false; try { seen = sessionStorage.getItem('rs.intro') === '1'; } catch (e) { /* ignore */ }
  var curtain = $('.curtain');
  if (curtain) {
    if (seen || reduce) { document.documentElement.classList.add('no-curtain'); }
    else { setTimeout(function () { curtain.classList.add('done'); }, 700); setTimeout(function () { curtain.remove(); }, 1900); try { sessionStorage.setItem('rs.intro', '1'); } catch (e) { /* ignore */ } }
  }

  /* header: shrink + hide on scroll down */
  var hdr = $('.hdr'), lastY = 0, ticking = false;
  window.addEventListener('scroll', function () {
    if (ticking) return; ticking = true;
    requestAnimationFrame(function () {
      var y = window.scrollY;
      hdr.classList.toggle('stuck', y > 20);
      hdr.classList.toggle('hide', y > lastY && y > 400 && !document.body.classList.contains('menu-open'));
      lastY = y; ticking = false;
    });
  }, { passive: true });

  var burger = $('.burger');
  if (burger) burger.addEventListener('click', function () {
    var o = document.body.classList.toggle('menu-open'); burger.setAttribute('aria-expanded', o);
  });

  /* scroll reveal */
  var rv = $$('[data-reveal]');
  rv.forEach(function (el) { var i = el.getAttribute('data-i'); if (i) el.style.setProperty('--i', i); });
  if ('IntersectionObserver' in window && !reduce) {
    var io = new IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    rv.forEach(function (el) { io.observe(el); });
  } else rv.forEach(function (el) { el.classList.add('in'); });

  /* count-up */
  var counters = $$('[data-count]');
  if (counters.length && 'IntersectionObserver' in window) {
    var co = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return; co.unobserve(e.target);
        var el = e.target, to = +el.getAttribute('data-count'), t0 = performance.now(), d = 1400;
        if (reduce) { el.textContent = to; return; }
        (function step(t) { var p = Math.min(1, (t - t0) / d); el.textContent = Math.round(to * (1 - Math.pow(1 - p, 4))); if (p < 1) requestAnimationFrame(step); })(t0);
      });
    }, { threshold: 0.5 });
    counters.forEach(function (c) { co.observe(c); });
  }

  /* hero parallax (pointer + scroll) — transforms only */
  var heroArt = $('.hero-art');
  if (heroArt && fine && !reduce) {
    var cards = $$('.hero-card', heroArt), px = 0, py = 0, raf = 0;
    heroArt.addEventListener('pointermove', function (e) {
      var r = heroArt.getBoundingClientRect(); px = (e.clientX - r.left) / r.width - 0.5; py = (e.clientY - r.top) / r.height - 0.5;
      if (!raf) raf = requestAnimationFrame(function () {
        cards.forEach(function (c, i) { var k = (i + 1) * 12; c.style.transform = 'translate3d(' + (px * k).toFixed(1) + 'px,' + (py * k).toFixed(1) + 'px,0) rotateY(' + (px * 6) + 'deg) rotateX(' + (-py * 6) + 'deg)'; });
        raf = 0;
      });
    }, { passive: true });
    heroArt.addEventListener('pointerleave', function () { cards.forEach(function (c) { c.style.transform = ''; }); });
  }

  /* magnetic buttons + card tilt */
  if (fine && !reduce) {
    $$('[data-magnetic]').forEach(function (b) {
      b.addEventListener('pointermove', function (e) { var r = b.getBoundingClientRect(); b.style.transform = 'translate(' + ((e.clientX - r.left - r.width / 2) * 0.18).toFixed(1) + 'px,' + ((e.clientY - r.top - r.height / 2) * 0.28).toFixed(1) + 'px)'; }, { passive: true });
      b.addEventListener('pointerleave', function () { b.style.transform = ''; });
    });
    $$('.card .ph').forEach(function (ph) {
      var f = 0;
      ph.addEventListener('pointermove', function (e) {
        if (f) return; f = requestAnimationFrame(function () {
          var r = ph.getBoundingClientRect(), x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
          ph.style.transform = 'perspective(800px) rotateY(' + (x * 7).toFixed(2) + 'deg) rotateX(' + (-y * 7).toFixed(2) + 'deg)'; f = 0;
        });
      }, { passive: true });
      ph.addEventListener('pointerleave', function () { ph.style.transform = ''; });
    });
  }

  /* toast */
  var toastEl, toastT;
  function toast(msg, opts) {
    opts = opts || {};
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.className = 'toast'; toastEl.setAttribute('role', 'status'); document.body.appendChild(toastEl); }
    toastEl.textContent = msg; toastEl.classList.toggle('err', !!opts.error);
    if (opts.href) { var a = document.createElement('a'); a.href = opts.href; a.textContent = opts.label || 'View'; toastEl.appendChild(a); }
    requestAnimationFrame(function () { toastEl.classList.add('show'); });
    clearTimeout(toastT); toastT = setTimeout(function () { toastEl.classList.remove('show'); }, 3600);
  }

  /* add to cart + fly-to-bag */
  var bag = $('.bag');
  function setCount(n) {
    var c = $('.bag .n'); if (c) c.textContent = n;
    if (bag) { bag.classList.remove('bump'); void bag.offsetWidth; bag.classList.add('bump'); }
  }
  function fly(from) {
    if (reduce || !bag || !from.animate) return;
    var a = from.getBoundingClientRect(), b = bag.getBoundingClientRect(), d = document.createElement('i');
    d.className = 'fly'; document.body.appendChild(d);
    var an = d.animate([
      { transform: 'translate(' + (a.left + a.width / 2) + 'px,' + (a.top + a.height / 2) + 'px) scale(1)', opacity: 1 },
      { transform: 'translate(' + (b.left + b.width / 2) + 'px,' + (b.top + b.height / 2) + 'px) scale(.3)', opacity: .4 }
    ], { duration: 750, easing: 'cubic-bezier(.5,-.2,.3,1)' });
    an.onfinish = function () { d.remove(); };
  }
  document.addEventListener('click', function (e) {
    var t = e.target.closest('[data-add]'); if (!t) return;
    e.preventDefault(); e.stopPropagation();
    var qEl = $('#qty'); var qty = qEl && t.hasAttribute('data-useqty') ? +qEl.textContent || 1 : 1;
    t.disabled = true;
    api('/api/cart/add', { id: +t.getAttribute('data-add'), qty: qty }).then(function (r) {
      fly(t); setCount(r.count); toast('Added to your bag', { href: '/cart', label: 'View bag' });
    }).catch(function (err) { toast(err.message, { error: true }); }).then(function () { t.disabled = false; });
  });

  /* product gallery */
  var stage = $('.stage');
  if (stage) {
    var main = $('img.main', stage), swap = $('img.swap', stage), thumbs = $$('.thumbs button'), cur = 0;
    var show = function (i) {
      var b = thumbs[i]; if (!b) return; cur = i;
      thumbs.forEach(function (x, k) { x.setAttribute('aria-current', k === i); });
      var vid = $('video.pv', stage);
      if (b.dataset.kind === 'video') { if (vid) { vid.hidden = false; vid.play().catch(function () {}); } main.style.opacity = 0; swap.style.opacity = 0; return; }
      if (vid) { vid.pause(); vid.hidden = true; }
      swap.src = b.dataset.src; swap.alt = b.dataset.alt || '';
      swap.style.opacity = 1; main.style.opacity = 0;
      setTimeout(function () { main.src = swap.src; main.alt = swap.alt; main.style.opacity = 1; swap.style.opacity = 0; }, 480);
    };
    thumbs.forEach(function (b, i) { b.addEventListener('click', function () { show(i); }); });
    stage.addEventListener('pointermove', function (e) {
      if (!fine) return; var r = stage.getBoundingClientRect();
      stage.classList.add('zoom'); main.style.transformOrigin = ((e.clientX - r.left) / r.width * 100) + '% ' + ((e.clientY - r.top) / r.height * 100) + '%';
    }, { passive: true });
    stage.addEventListener('pointerleave', function () { stage.classList.remove('zoom'); });
    document.addEventListener('keydown', function (e) { if (e.key === 'ArrowRight') show((cur + 1) % thumbs.length); if (e.key === 'ArrowLeft') show((cur - 1 + thumbs.length) % thumbs.length); });
  }
  /* qty stepper */
  $$('[data-step]').forEach(function (b) {
    b.addEventListener('click', function () { var o = $('#qty'); o.textContent = Math.min(10, Math.max(1, (+o.textContent || 1) + (+b.dataset.step))); });
  });
  /* live stock (served through Valkey) */
  var live = $('[data-live-stock]');
  if (live) api('/api/products/' + live.dataset.liveStock + '/summary').then(function (s) {
    live.textContent = s.stock < 1 ? 'Sold out' : s.stock <= 5 ? 'Only ' + s.stock + ' left' : 'In stock';
    live.className = 'stock' + (s.stock < 1 ? ' out' : s.stock <= 5 ? ' low' : '');
  }).catch(function () {});

  /* auto-submit filter selects */
  $$('select[data-auto], input[data-auto]').forEach(function (s) { s.addEventListener('change', function () { s.form.submit(); }); });

  /* cart page: update without reload, re-using server-rendered markup */
  function refreshCart() {
    return fetch('/cart', { credentials: 'same-origin' }).then(function (r) { return r.text(); }).then(function (html) {
      var doc = new DOMParser().parseFromString(html, 'text/html'), nw = $('#cart-root', doc), old = $('#cart-root');
      if (nw && old) { old.replaceWith(document.importNode(nw, true)); }
      var n = $('.bag .n', doc); if (n && $('.bag .n')) $('.bag .n').textContent = n.textContent;
    });
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-set]'); if (!b) return;
    e.preventDefault();
    api('/api/cart/set', { id: +b.dataset.set, qty: +b.dataset.qty }).then(refreshCart).catch(function (er) { toast(er.message, { error: true }); });
  });
  document.addEventListener('submit', function (e) {
    var f = e.target.closest('#coupon-form'); if (!f) return;
    e.preventDefault();
    api('/api/cart/coupon', { code: f.code.value }).then(function () { toast('Code applied'); return refreshCart(); }).catch(function (er) { toast(er.message, { error: true }); });
  });

  /* checkout */
  var chk = $('#checkout-form');
  if (chk) chk.addEventListener('submit', function (e) {
    e.preventDefault();
    var btn = $('button[type=submit]', chk), body = {}; btn.disabled = true;
    new FormData(chk).forEach(function (v, k) { body[k] = v; });
    api('/api/checkout', body).then(function (r) {
      if (r.provider === 'cashfree') return payCashfree(r);
      return api('/api/checkout/mock-pay', { orderId: r.orderId }).then(function (p) { location.href = '/orders/' + p.orderNo; });
    }).catch(function (er) { toast(er.message, { error: true }); btn.disabled = false; });
  });
  if (/[?&]e=payment_failed/.test(location.search)) toast('Payment was not completed. You have not been charged; please try again.', { error: true });
  function payCashfree(r) {
    if (!r.paymentSessionId) return Promise.reject(new Error('Cashfree did not return a payment session. Please try again.'));
    return new Promise(function (res, rej) {
      if (window.Cashfree) return res();
      var s = document.createElement('script'); s.src = 'https://sdk.cashfree.com/js/v3/cashfree.js'; s.onload = res; s.onerror = function () { rej(new Error('Could not load payment window')); }; document.head.appendChild(s);
    }).then(function () {
      if (typeof window.Cashfree !== 'function') throw new Error('Cashfree payment service did not load correctly. Please try again.');
      return window.Cashfree({ mode: r.mode === 'production' ? 'production' : 'sandbox' })
        .checkout({ paymentSessionId: r.paymentSessionId, redirectTarget: '_self' })
        .then(function (result) {
          if (result && result.error) throw new Error(result.error.message || 'Cashfree could not start payment. Please try again.');
          return result;
        });
    });
  }

  /* admin inline edits */
  document.addEventListener('change', function (e) {
    var t = e.target;
    if (t.matches('[data-admin-product]')) {
      var row = t.closest('tr'), body = { price_inr: +$('[name=price_inr]', row).value, stock: +$('[name=stock]', row).value, active: $('[name=active]', row).checked };
      api('/api/admin/products/' + t.closest('tr').dataset.id, body).then(function () { toast('Saved'); row.classList.add('ripple-ok'); }).catch(function (er) { toast(er.message, { error: true }); });
    } else if (t.matches('[data-admin-role]')) {
      api('/api/admin/users/' + t.dataset.adminRole + '/role', { role: t.value }).then(function () { toast('Role updated'); }).catch(function (er) { toast(er.message, { error: true }); });
    } else if (t.matches('[data-admin-order]')) {
      api('/api/admin/orders/' + t.dataset.adminOrder + '/status', { status: t.value }).then(function () { toast('Status updated'); }).catch(function (er) { toast(er.message, { error: true }); });
    }
  });
})();
