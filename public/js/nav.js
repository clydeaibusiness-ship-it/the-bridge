// Hamburger menu toggle
document.addEventListener('DOMContentLoaded', function() {
  var hamburger = document.querySelector('.site-nav-hamburger');
  var menu = document.getElementById('mobile-menu');
  var closeBtn = menu ? menu.querySelector('.site-nav-mobile-close') : null;

  if (hamburger && menu) {
    hamburger.addEventListener('click', function() {
      menu.classList.toggle('open');
    });
  }
  if (closeBtn && menu) {
    closeBtn.addEventListener('click', function() {
      menu.classList.remove('open');
    });
  }
  // Close menu when a link is clicked
  if (menu) {
    menu.querySelectorAll('a').forEach(function(link) {
      link.addEventListener('click', function() {
        menu.classList.remove('open');
      });
    });
  }
});
