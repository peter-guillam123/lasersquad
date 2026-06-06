// main.js — boot the game once the page is ready.
window.addEventListener('DOMContentLoaded', () => {
  LS.game.newGame();        // set up a board (sits behind the start screen)
  LS.render.init();
  LS.game.refreshReach();
  LS.render.centerOn(LS.config.tile * 2, LS.config.tile * 16); // frame the blue squad (behind the start screen)
  LS.render.draw();
  LS.input.init();
  LS.input.showStartScreen(); // choose a mode before play begins
});
