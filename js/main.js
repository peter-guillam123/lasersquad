// main.js — boot the game once the page is ready.
window.addEventListener('DOMContentLoaded', () => {
  LS.game.newGame();
  LS.render.init();
  LS.game.refreshReach();
  LS.render.draw();
  LS.input.init();
});
