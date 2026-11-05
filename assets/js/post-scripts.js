document.addEventListener("DOMContentLoaded", () => {
    if (typeof hljs !== 'undefined') hljs.highlightAll();

    const postContent = document.querySelector('.post-content');
    if (!postContent) return;

    const ICONS = {
        copy: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`,
        check: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>`,
        download: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`
    };

    function renderMarks(root) {
        const SKIP = new Set(['CODE', 'PRE', 'SCRIPT', 'STYLE', 'KBD', 'SAMP', 'TEXTAREA']);

        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                if (!/==[^=]+==/.test(node.nodeValue)) return NodeFilter.FILTER_REJECT;
                let parent = node.parentElement;
                while (parent && parent !== root) {
                    if (SKIP.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
                    parent = parent.parentElement;
                }
                return NodeFilter.FILTER_ACCEPT;
            }
        });

        const textNodes = [];
        let n;
        while ((n = walker.nextNode())) textNodes.push(n);

        for (const textNode of textNodes) {
            const value = textNode.nodeValue;
            const regex = /==([^=]+)==/g;
            const fragment = document.createDocumentFragment();
            let lastIndex = 0;
            let match;
            while ((match = regex.exec(value)) !== null) {
                if (match.index > lastIndex) {
                    fragment.appendChild(document.createTextNode(value.slice(lastIndex, match.index)));
                }
                const mark = document.createElement('mark');
                mark.textContent = match[1].trim();
                fragment.appendChild(mark);
                lastIndex = match.index + match[0].length;
            }
            if (lastIndex < value.length) {
                fragment.appendChild(document.createTextNode(value.slice(lastIndex)));
            }
            textNode.parentNode.replaceChild(fragment, textNode);
        }
    }

    renderMarks(postContent);

    postContent.querySelectorAll('img').forEach(img => {
        if (img.parentElement.tagName.toLowerCase() === 'figure') return;
        
        const figure = document.createElement('figure');
        figure.className = 'img-block';
        
        const parentP = img.closest('p');
        const container = (parentP && parentP.textContent.trim() === '') ? parentP : img;
        
        container.parentNode.insertBefore(figure, container);
        figure.appendChild(img); 
        
        if (parentP && parentP.textContent.trim() === '') {
            parentP.remove();
        }

        if (img.alt) {
            const figcaption = document.createElement('figcaption');
            figcaption.textContent = img.alt;
            figure.appendChild(figcaption);
        }
    });

    postContent.querySelectorAll('pre').forEach(pre => {
        if (pre.parentElement.classList.contains('code-container')) return;
        const code = pre.querySelector('code');
        if (!code) return;

        let lang = 'text';
        code.classList.forEach(cls => {
            if (cls.startsWith('language-')) lang = cls.replace('language-', '');
        });

        const wrapper = document.createElement('div');
        wrapper.className = 'code-container';
        wrapper.innerHTML = `
            <div class="code-header">
                <span class="code-lang">${lang}</span>
                <div class="code-actions">
                    <button class="btn-copy" title="Копировать">${ICONS.copy}</button>
                    <button class="btn-download" title="Скачать">${ICONS.download}</button>
                </div>
            </div>
        `;

        pre.parentNode.insertBefore(wrapper, pre);
        wrapper.appendChild(pre);
    });

    postContent.addEventListener('click', e => {
        const btn = e.target.closest('button');
        if (!btn) return;
        const wrapper = btn.closest('.code-container');
        const code = wrapper.querySelector('code');

        if (btn.classList.contains('btn-copy')) {
            navigator.clipboard.writeText(code.textContent).then(() => {
                btn.innerHTML = ICONS.check;
                setTimeout(() => btn.innerHTML = ICONS.copy, 2000);
            }).catch(console.error);
        }

        if (btn.classList.contains('btn-download')) {
            const lang = wrapper.querySelector('.code-lang').textContent.toLowerCase();
            const blob = new Blob([code.textContent], { type: 'text/plain;charset=utf-8' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `snippet.${lang === 'text' ? 'txt' : lang}`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }
    });
});