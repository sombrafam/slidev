import '@slidev/client/styles/layouts-base.css'
import './layouts.css'
import './prism.css'

const style = document.createElement('style');
style.textContent = `
  @import url('https://fonts.googleapis.com/css2?family=Ubuntu:wght@400;700&display=swap');

  * {
    font-family: 'Ubuntu', sans-serif;
  }

  .slidev-layout {
    background-image: url('/images/slides.png');
    background-size: cover;
  }

  /* You can add other global styles here */
`;

document.head.appendChild(style);