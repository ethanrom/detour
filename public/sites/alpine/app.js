/* Alpine Co-op: progressive enhancement for a properly built product page. */
(function () {
  "use strict";

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var COLORS = {
    Slate: { body: "#3d5a78", shade: "#2a4159", accent: "#f0b429" },
    Rust: { body: "#b5532f", shade: "#7f3418", accent: "#f0b429" },
    Moss: { body: "#5d7a4a", shade: "#405433", accent: "#ecebe3" },
    Ink: { body: "#2b2f36", shade: "#181b20", accent: "#f0b429" }
  };
  var VIEWS = {
    front: { box: "0 0 400 440", fg: "#jk-front", label: "front view", scene: false },
    back: { box: "0 0 400 440", fg: "#jk-back", label: "back view", scene: false },
    detail: { box: "100 60 200 220", fg: "#jk-front", label: "close-up of the hood and chest pocket", scene: false },
    trail: { box: "0 0 400 440", fg: "#jk-front", label: "on the trail", scene: true }
  };
  var PRICE = 229;
  var state = { color: "Slate", view: "front", items: [], timer: null };

  document.addEventListener("click", function (e) {
    var a = e.target.closest ? e.target.closest('a[href="#"]') : null;
    if (a) e.preventDefault();
  });
  $$("form").forEach(function (f) { f.addEventListener("submit", function (e) { e.preventDefault(); }); });

  var gallery = $("#gallery");
  var stageSvg = $("#stage-svg");
  var stageBg = $("#stage-bg");
  var stageFg = $("#stage-fg");

  function renderStage() {
    var v = VIEWS[state.view];
    stageSvg.setAttribute("viewBox", v.box);
    stageSvg.setAttribute("aria-label", "Summit Jacket in " + state.color + ", " + v.label);
    stageFg.setAttribute("href", v.fg);
    if (v.scene) {
      stageBg.setAttribute("href", "#scene");
      stageBg.setAttribute("width", "400");
      stageBg.setAttribute("height", "440");
      stageFg.setAttribute("x", "110"); stageFg.setAttribute("y", "150");
      stageFg.setAttribute("width", "180"); stageFg.setAttribute("height", "198");
    } else {
      stageBg.setAttribute("width", "0"); stageBg.setAttribute("height", "0");
      stageFg.setAttribute("x", "0"); stageFg.setAttribute("y", "0");
      stageFg.setAttribute("width", "400"); stageFg.setAttribute("height", "440");
    }
    $$(".thumb").forEach(function (t) {
      t.setAttribute("aria-pressed", String(t.getAttribute("data-view") === state.view));
    });
  }

  $$(".thumb").forEach(function (t) {
    t.addEventListener("click", function () { state.view = t.getAttribute("data-view"); renderStage(); });
  });

  $$('input[name="color"]').forEach(function (r) {
    r.addEventListener("change", function () {
      var c = COLORS[r.value];
      state.color = r.value;
      $("#color-name").textContent = r.value;
      gallery.style.setProperty("--jk-body", c.body);
      gallery.style.setProperty("--jk-shade", c.shade);
      gallery.style.setProperty("--jk-accent", c.accent);
      renderStage();
    });
  });

  function selectedSize() {
    var r = $('input[name="size"]:checked');
    return r ? r.value : null;
  }
  $$('input[name="size"]').forEach(function (r) {
    r.addEventListener("change", function () { $("#size-error").hidden = true; });
  });

  function toast(text) {
    var t = $("#toast");
    t.textContent = text;
    t.classList.add("is-visible");
    clearTimeout(state.timer);
    state.timer = setTimeout(function () { t.classList.remove("is-visible"); }, 3200);
  }

  function money(n) { return "$" + n.toFixed(2); }
  function itemCount() { return state.items.reduce(function (n, i) { return n + i.qty; }, 0); }

  function renderCart() {
    var count = itemCount();
    var badge = $("#cart-count");
    badge.textContent = String(count);
    badge.hidden = count === 0;
    $("#cart-button").setAttribute("aria-label", "Open cart, " + count + (count === 1 ? " item" : " items"));
    var body = $("#drawer-body");
    if (!state.items.length) {
      body.innerHTML = '<p class="cart-empty">Your cart is empty.</p>';
    } else {
      body.innerHTML = '<ul>' + state.items.map(function (i) {
        var c = COLORS[i.color];
        return '<li class="cart-line"><span class="pimg" style="--jk-body:' + c.body + ";--jk-shade:" + c.shade + ";--jk-accent:" + c.accent + '">' +
          '<svg viewBox="0 0 400 440" aria-hidden="true" focusable="false"><use href="#jk-front" width="400" height="440"/></svg></span>' +
          '<div><div class="cart-name">Summit Jacket</div><div class="cart-meta">' + i.color + " / " + i.size + " / Qty " + i.qty + "</div></div>" +
          "<b>" + money(PRICE * i.qty) + "</b></li>";
      }).join("") + "</ul>";
    }
    $("#subtotal").textContent = money(state.items.reduce(function (n, i) { return n + PRICE * i.qty; }, 0));
  }

  $("#add-to-cart").addEventListener("click", function () {
    var size = selectedSize();
    if (!size) {
      var err = $("#size-error");
      err.hidden = false;
      $("#size-xs").focus();
      return;
    }
    var found = state.items.filter(function (i) { return i.size === size && i.color === state.color; })[0];
    if (found) found.qty += 1;
    else state.items.push({ size: size, color: state.color, qty: 1 });
    renderCart();
    toast("Summit Jacket (" + state.color + ", " + size + ") added to your cart");
  });

  // Cart drawer: button with aria-expanded, focus moves in and returns on close.
  var cartBtn = $("#cart-button");
  function openDrawer() {
    $("#cart-panel").hidden = false;
    $("#drawer-overlay").hidden = false;
    cartBtn.setAttribute("aria-expanded", "true");
    $("#drawer-close").focus();
  }
  function closeDrawer() {
    if ($("#cart-panel").hidden) return;
    $("#cart-panel").hidden = true;
    $("#drawer-overlay").hidden = true;
    cartBtn.setAttribute("aria-expanded", "false");
    cartBtn.focus();
  }
  cartBtn.addEventListener("click", openDrawer);
  $("#drawer-close").addEventListener("click", closeDrawer);
  $("#drawer-overlay").addEventListener("click", closeDrawer);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeDrawer(); });

  renderCart();
  renderStage();
})();
