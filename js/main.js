// main.js — boot the game once the page is ready.
window.addEventListener('DOMContentLoaded', () => {
  LS.game.newGame();
  LS.render.init();
  LS.game.refreshReach();
  LS.render.centerOn(LS.config.tile * 3, LS.config.tile * 9.5); // frame the blue squad
  LS.render.draw();
  LS.input.init();
});
