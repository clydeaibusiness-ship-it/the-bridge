const fs = require('fs');
const path = require('path');

const SNIPPET = `  <!-- Microsoft Clarity -->
  <script type="text/javascript">
    (function(c,l,a,r,i,t,y){
        c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};
        t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;
        y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y);
    })(window, document, "clarity", "script", "xba4o8doyt");
  </script>
  <!-- Google tag (gtag.js) -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-XCBFTN02PY"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', 'G-XCBFTN02PY');
  </script>`;

const pagesDir = path.join(__dirname, '../pages');
const files = fs.readdirSync(pagesDir).filter(f => f.endsWith('.html'));

let updated = 0;
files.forEach(file => {
  const filePath = path.join(pagesDir, file);
  const content = fs.readFileSync(filePath, 'utf8');
  if (content.includes('G-XCBFTN02PY')) {
    console.log(`SKIP (already has analytics): ${file}`);
    return;
  }
  if (!content.includes('</head>')) {
    console.log(`SKIP (no </head> found): ${file}`);
    return;
  }
  const updated_content = content.replace('</head>', SNIPPET + '\n</head>');
  fs.writeFileSync(filePath, updated_content, 'utf8');
  console.log(`UPDATED: ${file}`);
  updated++;
});

console.log(`\nDone. ${updated} files updated.`);
