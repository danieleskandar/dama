(() => {
  "use strict";

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  function el(tag, attrs = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (key === "class") node.className = value;
      else if (key === "text") node.textContent = value;
      else node.setAttribute(key, value);
    }
    for (const child of [].concat(children)) if (child) node.append(child);
    return node;
  }

  // ---------------------------------------------------------------- videos

  // Loading: nothing is fetched until it matters. A video gets its poster
  // within a screen of the viewport and its file within half a screen, so it
  // is ready when it scrolls in. It plays while a quarter of it is visible and
  // pauses otherwise, also when the tab is hidden. With reduced motion or data
  // saver, videos wait for a click.
  const saveData = navigator.connection?.saveData === true;
  const manualPlay = reducedMotion || saveData;
  const visibleVideos = new Set();

  function setPoster(video) {
    if (video.dataset.poster && !video.poster) video.poster = video.dataset.poster;
  }

  function loadVideo(video) {
    setPoster(video);
    if (!video.src && video.dataset.src) {
      video.src = video.dataset.src;
      video.preload = "auto";
    }
  }

  const posterObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      setPoster(entry.target);
      posterObserver.unobserve(entry.target);
    }
  }, { rootMargin: "100% 0px" });

  const nearObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      if (!manualPlay) loadVideo(entry.target);
      nearObserver.unobserve(entry.target);
    }
  }, { rootMargin: "50% 0px" });

  const playObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const video = entry.target;
      if (entry.isIntersecting) {
        visibleVideos.add(video);
        if (manualPlay) setPoster(video);
        else {
          loadVideo(video);
          video.play().catch(() => { });
        }
      } else {
        visibleVideos.delete(video);
        video.pause();
      }
    }
  }, { threshold: 0.25 });

  document.addEventListener("visibilitychange", () => {
    for (const video of visibleVideos) {
      if (document.hidden) video.pause();
      else if (!manualPlay) video.play().catch(() => { });
    }
  });

  for (const video of $$("video[data-src]")) {
    video.muted = true;
    video.loop = true;
    video.playsInline = true;
    video.preload = "none";
    video.disablePictureInPicture = true;
    if (manualPlay) {
      video.controls = true;
      video.addEventListener("play", () => loadVideo(video), { once: true });
    }
    posterObserver.observe(video);
    nearObserver.observe(video);
    playObserver.observe(video);
  }

  // ---------------------------------------------------------------- dropdown

  const dropdown = $("#more-research");
  if (dropdown) {
    const button = $("button", dropdown);
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const open = dropdown.classList.toggle("open");
      button.setAttribute("aria-expanded", open);
    });
    const close = () => {
      dropdown.classList.remove("open");
      button.setAttribute("aria-expanded", "false");
    };
    document.addEventListener("click", close);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") close();
    });
  }

  // ---------------------------------------------------------------- navbar

  // The navbar slides in once the title has scrolled away, highlights the
  // section in view, and shows the reading progress along its bottom edge.
  const progress = $("#progress-bar");
  const navbar = $(".navbar");
  const navLinksBox = $(".navbar-links");
  const navLinks = $$(".navbar-links a");
  const sections = $$("main section[id]");
  const title = $(".hero .title");
  let lastActive = null;

  function onScroll() {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    if (progress) progress.style.width = `${max > 0 ? (window.scrollY / max) * 100 : 0}%`;
    if (navbar && title) navbar.classList.toggle("visible", title.getBoundingClientRect().bottom < 0);

    let current = null;
    for (const section of sections) {
      if (section.getBoundingClientRect().top <= window.innerHeight * 0.35) current = section.id;
    }
    // The acknowledgements belong to the end of the page: highlight BibTeX there.
    if (current === "acknowledgements") current = "bibtex";
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) current = "bibtex";
    for (const link of navLinks) {
      const active = link.getAttribute("href") === `#${current}`;
      link.classList.toggle("active", active);
      // On narrow screens the links scroll sideways: keep the active one in view.
      if (active && link !== lastActive && navLinksBox.scrollWidth > navLinksBox.clientWidth) {
        navLinksBox.scrollTo({ left: link.offsetLeft - (navLinksBox.clientWidth - link.offsetWidth) / 2, behavior: "smooth" });
        lastActive = link;
      }
    }
  }

  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll);
  onScroll();

  // ---------------------------------------------------------------- prose

  // A paragraph that would end on a short last line gets an imperceptible
  // letter-spacing change (at most 0.02 em), enough to reflow its last line.
  const SPACINGS = [0, -0.004, 0.004, -0.008, 0.008, -0.012, 0.012, -0.016, 0.016, -0.02, 0.02];

  function lastLineRatio(p) {
    const range = document.createRange();
    range.selectNodeContents(p);
    const rects = [...range.getClientRects()].filter((r) => r.width > 0);
    if (!rects.length) return 1;
    const bottom = Math.max(...rects.map((r) => r.top));
    const top = Math.min(...rects.map((r) => r.top));
    if (Math.abs(bottom - top) < 2) return 1;
    const last = rects.filter((r) => Math.abs(r.top - bottom) < 2);
    const width = Math.max(...last.map((r) => r.right)) - Math.min(...last.map((r) => r.left));
    return width / p.clientWidth;
  }

  function fitProse(minRatio = 0.2) {
    const paragraphs = $$(".prose > p, .section .wide > p").filter((p) => p.offsetParent !== null);
    for (const p of paragraphs) {
      let best = 0;
      let bestRatio = -1;
      for (const spacing of SPACINGS) {
        p.style.letterSpacing = spacing ? `${spacing}em` : "";
        const ratio = lastLineRatio(p);
        if (ratio >= minRatio) { best = spacing; bestRatio = ratio; break; }
        if (ratio > bestRatio) { best = spacing; bestRatio = ratio; }
      }
      p.style.letterSpacing = best ? `${best}em` : "";
    }
  }

  document.fonts?.ready.then(() => fitProse());
  window.addEventListener("resize", () => fitProse());
  fitProse();

  // ---------------------------------------------------------------- carousels

  // One video per slide: arrows level with the centre of the current video,
  // one dot per slide. Built around the slides already in the page.
  for (const container of $$("[data-carousel]")) {
    const slides = $$(":scope > .slide", container);
    const track = el("div", { class: "carousel-track" }, slides);
    const dots = el("div", { class: "dots" });
    let index = 0;

    const go = (i) => track.scrollTo({ left: track.children[i].offsetLeft - track.offsetLeft, behavior: "smooth" });
    slides.forEach((slide, i) => {
      slide.setAttribute("aria-label", `${i + 1} of ${slides.length}`);
      const dot = el("button", { "aria-label": `Show slide ${i + 1}` });
      dot.addEventListener("click", () => go(i));
      dots.append(dot);
    });

    const arrow = (dir, path, cls) => {
      const button = el("button", { class: `arrow ${cls}`, "aria-label": dir < 0 ? "Previous" : "Next" });
      button.innerHTML = `<svg class="icon" viewBox="0 0 24 24"><path d="${path}"/></svg>`;
      button.addEventListener("click", () => go((index + dir + slides.length) % slides.length));
      return button;
    };
    const stage = el("div", { class: "carousel-stage" }, [
      track, arrow(-1, "m15 18-6-6 6-6", "prev"), arrow(1, "m9 18 6-6-6-6", "next"),
    ]);

    function update() {
      index = Math.round(track.scrollLeft / track.clientWidth);
      $$("button", dots).forEach((dot, i) => dot.setAttribute("aria-current", i === index));
      // Warm the posters of the neighbouring slides, so a slide never appears blank.
      for (const neighbour of [track.children[index + 1], track.children[(index - 1 + slides.length) % slides.length]]) {
        if (neighbour) $$("video", neighbour).forEach(setPoster);
      }
      const media = $(".media", track.children[index] || track.children[0]);
      if (media) stage.style.setProperty("--arrow-top", `${media.offsetTop + media.offsetHeight / 2}px`);
    }
    track.addEventListener("scroll", () => requestAnimationFrame(update), { passive: true });
    window.addEventListener("resize", update);

    container.append(stage, el("div", { class: "carousel-nav" }, dots));
    update();
  }

  // ---------------------------------------------------------------- slides download

  const slidesButton = $("#slides-button");
  slidesButton?.addEventListener("click", () => {
    const text = $(".button-text", slidesButton);
    text.textContent = "Downloading...";
    setTimeout(() => { text.textContent = "Slides"; }, 2000);
  });

  // ---------------------------------------------------------------- bibtex

  const copyButton = $("#copy-bibtex");
  copyButton?.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText($("#bibtex-code").innerText);
      $("span", copyButton).textContent = "Copied";
      copyButton.classList.add("done");
      setTimeout(() => {
        $("span", copyButton).textContent = "Copy";
        copyButton.classList.remove("done");
      }, 2000);
    } catch (e) { }
  });

  // ---------------------------------------------------------------- reveal

  if (!reducedMotion) {
    const revealObserver = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add("in");
          revealObserver.unobserve(entry.target);
        }
      }
    }, { threshold: 0.08 });
    for (const node of $$(".section .narrow, .section .wide > *")) {
      node.classList.add("reveal");
      revealObserver.observe(node);
    }
  }
})();
