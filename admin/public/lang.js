// Shows Hebrew for ?lang=he, or for Hebrew browsers when no lang is given.
// Loaded in <head> so the page never flashes the wrong language.
(function () {
  var param = new URLSearchParams(location.search).get("lang");
  var hebrew = param ? param === "he" : /^he|^iw/i.test(navigator.language || "");
  var root = document.documentElement;
  if (hebrew) {
    root.classList.add("he");
    root.lang = "he";
    root.dir = "rtl";
    var title = root.getAttribute("data-title-he");
    if (title) document.title = title;
  }

  // Keep the chosen language when moving between the legal pages.
  document.addEventListener("DOMContentLoaded", function () {
    var links = document.querySelectorAll("nav.links a, a.brand, article a[href^='/']");
    for (var i = 0; i < links.length; i++) {
      links[i].href = links[i].getAttribute("href") + "?lang=" + (hebrew ? "he" : "en");
    }
  });
})();
