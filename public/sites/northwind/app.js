/* Northwind Outfitters: tiny demo interactions. */
(function () {
  "use strict";

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var COLORS = {
    Forest: { body: "#2e5e4e", shade: "#1d4034", accent: "#e3a04a" },
    Ember: { body: "#c4502a", shade: "#8f3516", accent: "#2b2f33" },
    Glacier: { body: "#4a7ea8", shade: "#2f5a7e", accent: "#e9eef2" },
    Charcoal: { body: "#3a4046", shade: "#23282c", accent: "#d8613a" },
    Sand: { body: "#c8b48a", shade: "#9c8a62", accent: "#2e5e4e" }
  };
  var VIEWS = {
    front: { box: "0 0 400 440", bg: "", fg: "#jk-front", label: "front view", scene: false },
    back: { box: "0 0 400 440", bg: "", fg: "#jk-back", label: "back view", scene: false },
    detail: { box: "100 60 200 220", bg: "", fg: "#jk-front", label: "close-up of the hood and chest pocket", scene: false },
    trail: { box: "0 0 400 440", bg: "#scene", fg: "#jk-front", label: "on the trail", scene: true }
  };
  var PRICE = 189;

  var state = { size: null, color: "Forest", view: "front", items: [], timer: null };

  // Keep "#" links from jumping to the top of the page.
  document.addEventListener("click", function (e) {
    var a = e.target.closest ? e.target.closest('a[href="#"]') : null;
    if (a) e.preventDefault();
  });

  var gallery = $("#gallery");
  var stageSvg = $("#stage-svg");
  var stageBg = $("#stage-bg");
  var stageFg = $("#stage-fg");

  function renderStage() {
    var v = VIEWS[state.view];
    stageSvg.setAttribute("viewBox", v.box);
    stageSvg.setAttribute("aria-label", "Trail Jacket in " + state.color + ", " + v.label);
    stageFg.setAttribute("href", v.fg);
    if (v.scene) {
      stageBg.setAttribute("href", v.bg);
      stageBg.setAttribute("width", "400");
      stageBg.setAttribute("height", "440");
      stageFg.setAttribute("x", "110");
      stageFg.setAttribute("y", "150");
      stageFg.setAttribute("width", "180");
      stageFg.setAttribute("height", "198");
    } else {
      stageBg.setAttribute("width", "0");
      stageBg.setAttribute("height", "0");
      stageFg.setAttribute("x", "0");
      stageFg.setAttribute("y", "0");
      stageFg.setAttribute("width", "400");
      stageFg.setAttribute("height", "440");
    }
    $$(".thumb").forEach(function (t) {
      t.classList.toggle("is-active", t.getAttribute("data-view") === state.view);
    });
  }

  // Colour swatches
  $$(".swatch").forEach(function (sw) {
    sw.addEventListener("click", function () {
      var name = sw.getAttribute("data-color");
      var c = COLORS[name];
      state.color = name;
      $$(".swatch").forEach(function (s) { s.classList.toggle("is-selected", s === sw); });
      $("#color-name").textContent = name;
      gallery.style.setProperty("--jk-body", c.body);
      gallery.style.setProperty("--jk-shade", c.shade);
      gallery.style.setProperty("--jk-accent", c.accent);
      renderStage();
    });
  });

  // Gallery thumbnails
  $$(".thumb").forEach(function (t) {
    t.addEventListener("click", function () {
      state.view = t.getAttribute("data-view");
      renderStage();
    });
  });

  // Size picker
  $$(".size-opt").forEach(function (opt) {
    opt.addEventListener("click", function () {
      state.size = opt.getAttribute("data-size");
      $$(".size-opt").forEach(function (o) { o.classList.toggle("is-selected", o === opt); });
      $("#size-name").textContent = state.size;
      $(".sizes").classList.remove("has-error");
      $("#size-error").hidden = true;
    });
  });

  // Toast
  function toast(text, isError) {
    var t = $("#toast");
    $("#toast-text").textContent = text;
    t.classList.toggle("is-error", !!isError);
    t.hidden = false;
    clearTimeout(state.timer);
    state.timer = setTimeout(function () { t.hidden = true; }, 3200);
  }

  // Cart
  function money(n) { return "$" + n.toFixed(2); }

  function renderCart() {
    var count = state.items.reduce(function (n, i) { return n + i.qty; }, 0);
    var badge = $(".cart-count");
    badge.textContent = String(count);
    badge.hidden = count === 0;
    badge.classList.remove("bump");
    void badge.offsetWidth;
    if (count) badge.classList.add("bump");

    var body = $("#drawer-body");
    if (!state.items.length) {
      body.innerHTML = '<div class="cart-empty">Your cart is empty.</div>';
    } else {
      body.innerHTML = state.items.map(function (i) {
        var c = COLORS[i.color];
        return '<div class="cart-line">' +
          '<div class="pimg" style="--jk-body:' + c.body + ";--jk-shade:" + c.shade + ";--jk-accent:" + c.accent + '">' +
          '<svg viewBox="0 0 400 440"><use href="#jk-front" width="400" height="440"/></svg></div>' +
          "<div><div class=\"cart-name\">Trail Jacket</div><div class=\"cart-meta\">" + i.color + " / " + i.size + " / Qty " + i.qty + "</div></div>" +
          "<b>" + money(PRICE * i.qty) + "</b></div>";
      }).join("");
    }
    $("#subtotal").textContent = money(state.items.reduce(function (n, i) { return n + PRICE * i.qty; }, 0));
  }

  $('[data-detour-id="add-to-cart"]').addEventListener("click", function () {
    if (!state.size) {
      $(".sizes").classList.add("has-error");
      $("#size-error").hidden = false;
      toast("Please choose a size first", true);
      return;
    }
    var found = state.items.filter(function (i) { return i.size === state.size && i.color === state.color; })[0];
    if (found) found.qty += 1;
    else state.items.push({ size: state.size, color: state.color, qty: 1 });
    renderCart();
    toast("Trail Jacket (" + state.color + ", " + state.size + ") added to your cart");
  });

  function openDrawer() {
    $("#drawer-overlay").hidden = false;
    $("#drawer").hidden = false;
  }
  function closeDrawer() {
    $("#drawer-overlay").hidden = true;
    $("#drawer").hidden = true;
  }
  $(".icon-cart").addEventListener("click", openDrawer);
  $("#drawer-close").addEventListener("click", closeDrawer);
  $("#drawer-overlay").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeDrawer(); });

  // Wishlist hearts
  $(".icon-wishlist").addEventListener("click", function () { this.classList.toggle("is-active"); });
  $(".btn-wish").addEventListener("click", function () {
    var on = this.classList.toggle("is-active");
    toast(on ? "Saved to your wishlist" : "Removed from your wishlist");
  });

  // Newsletter
  $('[data-detour-id="newsletter-submit"]').addEventListener("click", function () {
    var input = $(".newsletter-input");
    if (input.value.indexOf("@") < 1) { toast("Enter a valid email address", true); return; }
    toast("Thanks! Your 10% code is on its way");
    input.value = "";
  });

  renderCart();
  renderStage();
})();
