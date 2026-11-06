/* Riverside County FreshStart: tiny demo interactions. */
(function () {
  "use strict";

  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  var timer = null;
  function toast(text) {
    var t = $("#toast");
    $("#toast-text").textContent = text;
    t.hidden = false;
    clearTimeout(timer);
    timer = setTimeout(function () { t.hidden = true; }, 3400);
  }

  // Keep "#" links from jumping to the top of the page.
  document.addEventListener("click", function (e) {
    var a = e.target.closest ? e.target.closest('a[href="#"]') : null;
    if (a) e.preventDefault();
  });

  // Government banner: "Here's how you know"
  $("#gov-know").addEventListener("click", function () {
    var p = $("#gov-panel");
    p.hidden = !p.hidden;
  });

  // Language links: always-visible span options with click listeners
  var translatable = $$("[data-es]");
  translatable.forEach(function (el) { el.setAttribute("data-en", el.innerHTML); });

  function setLanguage(code) {
    var toSpanish = code === "es";
    translatable.forEach(function (el) {
      el.innerHTML = toSpanish ? el.getAttribute("data-es") : el.getAttribute("data-en");
    });
    document.documentElement.setAttribute("lang", toSpanish || code === "en" ? code : "en");
    $$(".lang-opt").forEach(function (o) { o.classList.toggle("is-selected", o.getAttribute("data-lang") === code); });
    if (code !== "en" && code !== "es") toast("This translation is still being reviewed. Showing English for now.");
  }

  $$(".lang-opt").forEach(function (opt) {
    opt.addEventListener("click", function () {
      setLanguage(opt.getAttribute("data-lang"));
    });
  });

  // FAQ accordion (div toggles)
  $$(".faq-q").forEach(function (q) {
    q.addEventListener("click", function () {
      var item = q.parentNode;
      var answer = $(".faq-a", item);
      var open = answer.hidden;
      answer.hidden = !open;
      item.classList.toggle("is-open", open);
    });
  });

  // Application link (a real anchor): the portal is outside this demo
  $("#apply-link").addEventListener("click", function (e) {
    e.preventDefault();
    toast("Opening the secure application portal...");
  });
  $('[data-detour-id="find-pantry"]').addEventListener("click", function () {
    toast("Pantry finder is not part of this demo");
  });

  // Floating widgets
  $("#chat-launcher").addEventListener("click", function () {
    var panel = $("#chat-panel");
    panel.hidden = !panel.hidden;
  });
  $("#feedback-tab").addEventListener("click", function () {
    toast("Thanks! Feedback form would open here");
  });
  $$(".chat-chip").forEach(function (c) {
    c.addEventListener("click", function () { toast("A county representative will reply shortly"); });
  });
})();
