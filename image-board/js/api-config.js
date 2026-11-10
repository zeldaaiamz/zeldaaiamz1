/* Pages → ECS；本机同源空 base */
(function () {
  var local = ["127.0.0.1", "localhost"].includes(location.hostname);
  window.BOARD_API_BASE = local ? "" : "https://47.98.137.124/image-board-api";
})();
