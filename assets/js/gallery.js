/*
	Cougatronix — Product Gallery
	- Filterable grid of builds (reads data straight from the card markup)
	- <dialog> viewer: crossfade, swipe, click-to-zoom with pan, thumbnails, spec panel
	- Slideshow: auto-advance with progress bar, Ken Burns motion, idle-hiding controls, full screen
*/
(function () {
	'use strict';

	var article = document.getElementById('gallery');
	var dialog = document.getElementById('pg-viewer');
	if (!article || !dialog) return;

	var grid = document.getElementById('pg-grid');
	var frame = document.getElementById('pg-frame');
	var imgs = frame.querySelectorAll('.pg-viewer__img');
	var counter = document.getElementById('pg-counter');
	var panel = document.getElementById('pg-panel');
	var caption = document.getElementById('pg-caption');
	var thumbs = document.getElementById('pg-thumbs');
	var bar = dialog.querySelector('.pg-viewer__progress span');
	var btnPlay = document.getElementById('pg-play');
	var btnZoom = document.getElementById('pg-zoom');
	var btnFull = document.getElementById('pg-fullscreen');
	var chips = article.querySelectorAll('.pg-chip');

	var items = [];
	var index = 0;
	var playing = false;
	var zoomed = false;
	var renderToken = 0;
	var idleTimer = null;
	var lastClosedAt = 0;
	var filter = 'all';

	frame.setAttribute('tabindex', '-1');

	/* ---------- Helpers ---------- */

	function allCards() {
		return Array.prototype.slice.call(grid.querySelectorAll('.pg-card'));
	}

	function visibleCards() {
		return allCards().filter(function (c) { return !c.hidden; });
	}

	function readCard(card) {
		var img = card.querySelector('.pg-card__media img');
		return {
			card: card,
			thumb: img.getAttribute('src'),
			full: img.getAttribute('data-full') || img.getAttribute('src'),
			alt: img.getAttribute('alt') || '',
			brand: card.querySelector('.pg-card__brand').textContent.trim(),
			title: card.querySelector('.pg-card__open').textContent.trim(),
			leds: card.querySelector('.pg-leds').outerHTML,
			specs: card.querySelector('.pg-specs').innerHTML,
			finish: card.style.getPropertyValue('--finish')
		};
	}

	function pad(n) { return (n < 10 ? '0' : '') + n; }

	function escapeHtml(s) {
		return s.replace(/[&<>"']/g, function (c) {
			return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
		});
	}

	/* ---------- Grid: filters, counts, stagger ---------- */

	function refreshGrid() {
		var cards = allCards();
		var counts = { all: cards.length, right: 0, left: 0 };

		cards.forEach(function (card) {
			counts[card.dataset.handed] = (counts[card.dataset.handed] || 0) + 1;
			card.hidden = !(filter === 'all' || card.dataset.handed === filter);
		});

		visibleCards().forEach(function (card, i) {
			card.style.setProperty('--i', i);
			// Restart the entrance animation so filtering feels responsive.
			card.style.animation = 'none';
			void card.offsetWidth;
			card.style.animation = '';
		});

		chips.forEach(function (chip) {
			var f = chip.dataset.filter;
			chip.querySelector('.pg-chip__count').textContent = counts[f] || 0;
			// Hide a filter that would show nothing (e.g. no left-handed stock).
			chip.hidden = f !== 'all' && !counts[f];
		});
	}

	chips.forEach(function (chip) {
		chip.addEventListener('click', function () {
			filter = chip.dataset.filter;
			chips.forEach(function (c) {
				var on = c === chip;
				c.classList.toggle('is-active', on);
				c.setAttribute('aria-pressed', on ? 'true' : 'false');
			});
			refreshGrid();
		});
	});

	// Drop any card whose photo is missing so the grid/slideshow never shows a broken image.
	allCards().forEach(function (card) {
		var img = card.querySelector('.pg-card__media img');
		img.addEventListener('error', function () { card.remove(); refreshGrid(); }, { once: true });
		if (location.protocol.indexOf('http') === 0 && window.fetch) {
			fetch(img.getAttribute('src'), { method: 'HEAD' })
				.then(function (r) { if (!r.ok) { card.remove(); refreshGrid(); } })
				.catch(function () {});
		}
	});

	refreshGrid();

	/* ---------- Viewer rendering ---------- */

	function buildThumbs() {
		thumbs.innerHTML = '';
		items.forEach(function (item, i) {
			var b = document.createElement('button');
			b.type = 'button';
			b.className = 'pg-thumb';
			b.id = 'pg-thumb-' + i;
			b.setAttribute('role', 'tab');
			b.setAttribute('aria-label', item.brand + ' ' + item.title);
			b.innerHTML = '<img src="' + item.thumb + '" alt="" loading="lazy" decoding="async" />';
			b.addEventListener('click', function () { go(i); });
			thumbs.appendChild(b);
		});
	}

	function preload(i) {
		var item = items[(i + items.length) % items.length];
		if (item) { var im = new Image(); im.decoding = 'async'; im.src = item.full; }
	}

	function render() {
		var item = items[index];
		if (!item) return;
		var token = ++renderToken;

		var current = frame.querySelector('.pg-viewer__img.is-current');
		var incoming = current === imgs[0] ? imgs[1] : imgs[0];

		setZoom(false);
		incoming.src = item.full;
		incoming.alt = item.alt;

		var swap = function () {
			if (token !== renderToken) return;
			current.classList.remove('is-current');
			current.setAttribute('aria-hidden', 'true');
			incoming.classList.add('is-current');
			incoming.removeAttribute('aria-hidden');
		};
		(incoming.decode ? incoming.decode() : Promise.resolve()).then(swap, swap);

		counter.innerHTML = '<b>' + pad(index + 1) + '</b> / ' + pad(items.length);
		dialog.style.setProperty('--finish', item.finish);

		panel.innerHTML =
			'<p class="pg-panel__brand">' + escapeHtml(item.brand) + '</p>' +
			'<h3 class="pg-panel__title">' + escapeHtml(item.title) + '</h3>' +
			item.leds +
			'<dl>' + item.specs + '</dl>' +
			'<a class="pg-panel__cta" id="pg-inquire" href="mailto:Cougatronix@yahoo.com?subject=' +
				encodeURIComponent('Inquiry: ' + item.brand + ' – ' + item.title) + '">' +
				'<i class="fas fa-envelope" aria-hidden="true"></i> Ask about this build</a>' +
			'<p class="pg-panel__hint"><kbd>←</kbd> <kbd>→</kbd> browse &nbsp;·&nbsp; <kbd>Space</kbd> slideshow' +
				' &nbsp;·&nbsp; <kbd>Z</kbd> zoom &nbsp;·&nbsp; <kbd>F</kbd> full screen</p>';

		caption.innerHTML =
			'<p>' + escapeHtml(item.brand) + '</p>' +
			'<h3>' + escapeHtml(item.title) + '</h3>' +
			item.leds;

		Array.prototype.forEach.call(thumbs.children, function (t, i) {
			t.setAttribute('aria-selected', i === index ? 'true' : 'false');
			t.tabIndex = i === index ? 0 : -1;
		});
		var active = thumbs.children[index];
		if (active) {
			// Scroll only the strip itself. scrollIntoView() would also scroll ancestors (even overflow:hidden
			// ones), shifting the whole stage and dragging the prev/next buttons with it.
			var target = active.offsetLeft - (thumbs.clientWidth - active.offsetWidth) / 2;
			thumbs.scrollTo({ left: Math.max(0, target), behavior: 'smooth' });
		}

		preload(index + 1);
		preload(index - 1);

		if (playing) restartProgress();
	}

	function go(i) {
		if (!items.length) return;
		index = (i + items.length) % items.length;
		render();
	}

	function next() { go(index + 1); }
	function prev() { go(index - 1); }

	/* ---------- Open / close ---------- */

	function open(startIndex, autoplay) {
		items = visibleCards().map(readCard);
		if (!items.length) return;
		index = Math.max(0, Math.min(startIndex || 0, items.length - 1));
		buildThumbs();
		dialog.removeAttribute('data-closing');
		dialog.showModal();
		frame.focus({ preventScroll: true });
		render();
		if (autoplay) play(); else stop();
	}

	// Exit animation fallback for browsers that can't transition `display`/`overlay` (Firefox, Safari).
	var displayTransition;
	function canTransitionDisplay() {
		if (displayTransition !== undefined) return displayTransition;
		if (!(window.CSS && CSS.supports && CSS.supports('transition-behavior', 'allow-discrete'))) {
			return (displayTransition = false);
		}
		var probe = document.createElement('div');
		probe.style.cssText = 'transition: display 1s allow-discrete !important; display: block;';
		document.body.appendChild(probe);
		getComputedStyle(probe).display;
		probe.style.display = 'none';
		displayTransition = getComputedStyle(probe).display === 'block';
		probe.remove();
		return displayTransition;
	}

	function supportsTopLayerExit() {
		return !!(window.CSS && CSS.supports && CSS.supports('overlay', 'auto')) && canTransitionDisplay();
	}

	function close() {
		if (!dialog.open) return;
		stop();
		setZoom(false);
		if (document.fullscreenElement) document.exitFullscreen().catch(function () {});
		lastClosedAt = performance.now();

		if (supportsTopLayerExit()) { dialog.close(); return; }

		dialog.setAttribute('data-closing', '');
		var anims = dialog.getAnimations ? dialog.getAnimations({ subtree: false }) : [];
		var done = function () {
			if (!dialog.hasAttribute('data-closing')) return;
			dialog.removeAttribute('data-closing');
			dialog.close();
			lastClosedAt = performance.now();
		};
		if (anims.length) {
			Promise.race([
				Promise.allSettled(anims.map(function (a) { return a.finished; })),
				new Promise(function (r) { setTimeout(r, 600); })
			]).then(done);
		} else {
			done();
		}
	}

	dialog.addEventListener('cancel', function (e) {
		e.preventDefault();
		if (zoomed) setZoom(false);
		else close();
	});

	// The template closes the whole article on Escape keyup. Swallow that keyup when it belongs to the viewer.
	window.addEventListener('keyup', function (e) {
		if ((e.key === 'Escape' || e.keyCode === 27) &&
			(dialog.open || performance.now() - lastClosedAt < 600)) {
			e.stopImmediatePropagation();
		}
	}, true);

	// If the article is navigated away from (e.g. browser Back), don't leave a modal stranded.
	window.addEventListener('hashchange', function () {
		if (dialog.open && location.hash !== '#gallery') {
			stop();
			dialog.close();
		}
	});

	/* ---------- Slideshow ---------- */

	function setPlayButton() {
		var icon = btnPlay.querySelector('i');
		icon.className = 'fas ' + (playing ? 'fa-pause' : 'fa-play');
		btnPlay.setAttribute('aria-label', playing ? 'Pause slideshow' : 'Play slideshow');
	}

	function restartProgress() {
		bar.classList.remove('is-running');
		void bar.offsetWidth;
		bar.classList.add('is-running');
	}

	function play() {
		if (items.length < 2) return;
		playing = true;
		setZoom(false);
		dialog.classList.add('is-playing');
		dialog.classList.remove('is-paused');
		setPlayButton();
		restartProgress();
		wake();
	}

	function stop() {
		playing = false;
		dialog.classList.remove('is-playing', 'is-paused', 'is-idle');
		bar.classList.remove('is-running');
		clearTimeout(idleTimer);
		setPlayButton();
	}

	function togglePlay() { playing ? stop() : play(); }

	bar.addEventListener('animationend', function () {
		if (playing && !dialog.classList.contains('is-paused')) next();
	});

	document.addEventListener('visibilitychange', function () {
		if (playing) dialog.classList.toggle('is-paused', document.hidden);
	});

	function wake() {
		dialog.classList.remove('is-idle');
		clearTimeout(idleTimer);
		if (playing) idleTimer = setTimeout(function () { dialog.classList.add('is-idle'); }, 2500);
	}

	dialog.addEventListener('pointermove', wake);

	/* ---------- Zoom + swipe ---------- */

	function setOrigin(clientX, clientY) {
		var r = frame.getBoundingClientRect();
		var x = Math.max(0, Math.min(100, ((clientX - r.left) / r.width) * 100));
		var y = Math.max(0, Math.min(100, ((clientY - r.top) / r.height) * 100));
		imgs[0].style.setProperty('--ox', x + '%');
		imgs[0].style.setProperty('--oy', y + '%');
		imgs[1].style.setProperty('--ox', x + '%');
		imgs[1].style.setProperty('--oy', y + '%');
	}

	function setZoom(on, clientX, clientY) {
		if (on && playing) stop();
		if (on && clientX !== undefined) setOrigin(clientX, clientY);
		else if (on) setOrigin(frame.getBoundingClientRect().left + frame.clientWidth / 2,
			frame.getBoundingClientRect().top + frame.clientHeight / 2);
		zoomed = !!on;
		dialog.classList.toggle('is-zoomed', zoomed);
		btnZoom.querySelector('i').className = 'fas ' + (zoomed ? 'fa-search-minus' : 'fa-search-plus');
		btnZoom.setAttribute('aria-label', zoomed ? 'Zoom out' : 'Zoom in');
	}

	var down = null;

	frame.addEventListener('pointerdown', function (e) {
		down = { x: e.clientX, y: e.clientY, t: Date.now() };
	});

	frame.addEventListener('pointermove', function (e) {
		if (zoomed) setOrigin(e.clientX, e.clientY);
	});

	frame.addEventListener('pointerup', function (e) {
		if (!down) return;
		var dx = e.clientX - down.x;
		var dy = e.clientY - down.y;
		var moved = Math.abs(dx) > 8 || Math.abs(dy) > 8;
		down = null;

		if (!zoomed && Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.2) {
			dx < 0 ? next() : prev();
			return;
		}
		if (moved) return;

		// Tap/click: in slideshow it pauses (revealing specs); otherwise toggles zoom at that spot.
		if (playing) stop();
		else setZoom(!zoomed, e.clientX, e.clientY);
	});

	frame.addEventListener('pointercancel', function () { down = null; });

	/* ---------- Full screen ---------- */

	if (!document.fullscreenEnabled || !dialog.requestFullscreen) {
		btnFull.hidden = true;
	}

	function toggleFullscreen() {
		if (document.fullscreenElement) document.exitFullscreen().catch(function () {});
		else if (dialog.requestFullscreen) dialog.requestFullscreen().catch(function () {});
	}

	document.addEventListener('fullscreenchange', function () {
		var on = document.fullscreenElement === dialog;
		btnFull.querySelector('i').className = 'fas ' + (on ? 'fa-compress' : 'fa-expand');
		btnFull.setAttribute('aria-label', on ? 'Exit full screen' : 'Enter full screen');
	});

	/* ---------- Wiring ---------- */

	document.getElementById('pg-next').addEventListener('click', function () { next(); if (playing) wake(); });
	document.getElementById('pg-prev').addEventListener('click', function () { prev(); if (playing) wake(); });
	document.getElementById('pg-close').addEventListener('click', close);
	btnPlay.addEventListener('click', togglePlay);
	btnZoom.addEventListener('click', function () { setZoom(!zoomed); });
	btnFull.addEventListener('click', toggleFullscreen);

	dialog.addEventListener('keydown', function (e) {
		var tag = e.target.tagName;
		var onControl = tag === 'BUTTON' || tag === 'A';
		wake();
		switch (e.key) {
			case 'ArrowRight': e.preventDefault(); next(); break;
			case 'ArrowLeft': e.preventDefault(); prev(); break;
			case 'Home': e.preventDefault(); go(0); break;
			case 'End': e.preventDefault(); go(items.length - 1); break;
			case ' ':
				if (onControl) return; // let Space activate the focused button
				e.preventDefault(); togglePlay(); break;
			case 'z': case 'Z': setZoom(!zoomed); break;
			case 'f': case 'F': if (!btnFull.hidden) toggleFullscreen(); break;
		}
	});

	grid.addEventListener('click', function (e) {
		var btn = e.target.closest('.pg-card__open');
		if (!btn) return;
		var card = btn.closest('.pg-card');
		open(visibleCards().indexOf(card), false);
	});

	document.getElementById('pg-start-slideshow').addEventListener('click', function () {
		open(0, true);
	});
})();
