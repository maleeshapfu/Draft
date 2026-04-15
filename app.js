/**
 * IndexedDB Wrapper
 */
const DB = {
    db: null,
    async init() {
        return new Promise((resolve, reject) => {
            const req = indexedDB.open('AdvancedNotepadDB', 1);
            req.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains('notes')) db.createObjectStore('notes', { keyPath: 'id' });
                if (!db.objectStoreNames.contains('profile')) db.createObjectStore('profile', { keyPath: 'id' });
                // We store attachments inside the note object itself as Blobs
            };
            req.onsuccess = (e) => { this.db = e.target.result; resolve(); };
            req.onerror = (e) => { reject(e); };
        });
    },
    async get(storeName, id) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readonly');
            const req = tx.objectStore(storeName).get(id);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    },
    async put(storeName, item) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readwrite');
            const req = tx.objectStore(storeName).put(item);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    },
    async getAll(storeName) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readonly');
            const req = tx.objectStore(storeName).getAll();
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    },
    async delete(storeName, id) {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, 'readwrite');
            const req = tx.objectStore(storeName).delete(id);
            req.onsuccess = () => resolve();
            req.onerror = () => reject(req.error);
        });
    }
};

/**
 * Application State
 */
const App = {
    notes: [],
    profile: { id: 'me', name: 'Floyd Lawton', avatar: '' },
    activeNoteId: null,
    theme: localStorage.getItem('theme') || 'light',
    
    // Elements
    els: {
        notesList: document.getElementById('notes-list'),
        editorEmpty: document.getElementById('editor-empty-state'),
        titleInput: document.getElementById('note-title-input'),
        content: document.getElementById('editor-content'),
        searchInput: document.getElementById('search-input'),
        fileInput: document.getElementById('file-input'),
    },

    async init() {
        await DB.init();
        
        // Load Theme
        document.documentElement.setAttribute('data-theme', this.theme);
        
        // Load Profile
        let p = await DB.get('profile', 'me');
        if (p) this.profile = p;
        else this.profile.avatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(this.profile.name)}&background=random`;
        this.updateProfileUI();

        // Load Notes
        this.notes = await DB.getAll('notes');
        
        // Sort by last modified descending
        this.notes.sort((a,b) => b.lastModified - a.lastModified);
        
        // Initial Note list render
        this.renderNotesList();

        this.setupListeners();
    },

    setupListeners() {
        document.getElementById('theme-toggle').onclick = () => {
            this.theme = this.theme === 'light' ? 'dark' : 'light';
            document.documentElement.setAttribute('data-theme', this.theme);
            localStorage.setItem('theme', this.theme);
        };

        document.getElementById('new-note-btn').onclick = () => this.createNewNote();
        document.getElementById('delete-note-btn').onclick = () => this.deleteActiveNote();
        
        // Auto Save
        this.els.titleInput.addEventListener('input', () => {
            this.debounceSave();
            this.updateActiveNoteTitleInList();
            document.getElementById('breadcrumb-text').innerHTML = `
                <button class="tool-btn" id="mobile-menu-btn" style="display:none; margin-right:8px;" onclick="UI.toggleSidebar()"><i class="ph ph-list"></i></button>
                My Notes > ${this.els.titleInput.value || 'Untitled'}`;
        });
        
        this.els.content.addEventListener('input', () => {
            this.debounceSave();
        });

        // Formatting - Use execCommand as fallback but manually handling might be needed for robustness. 
        // For this single file implementation, execCommand is standard.
        document.querySelectorAll('.tool-btn[data-command]').forEach(btn => {
            btn.onclick = (e) => {
                e.preventDefault();
                const cmd = btn.getAttribute('data-command');
                document.execCommand(cmd, false, null); 
                this.els.content.focus();
                this.saveCurrentNote();
            }
        });

        // Search Filter
        this.els.searchInput.addEventListener('input', (e) => {
            this.renderNotesList(e.target.value.toLowerCase());
        });

        // Attachments
        document.getElementById('attach-btn').onclick = () => this.els.fileInput.click();
        this.els.fileInput.onchange = (e) => this.handleFiles(e.target.files);
    },

    debounceTimer: null,
    debounceSave() {
        clearTimeout(this.debounceTimer);
        this.debounceTimer = setTimeout(() => this.saveCurrentNote(), 600);
    },

    updateProfileUI() {
        document.getElementById('sidebar-username').innerText = this.profile.name;
        document.getElementById('sidebar-avatar').src = this.profile.avatar;
        document.getElementById('meta-author').innerText = this.profile.name;
        document.getElementById('meta-avatar').src = this.profile.avatar;
    },

    async saveProfile() {
        const nameInput = document.getElementById('profile-name-input').value;
        if(nameInput.trim()) {
            this.profile.name = nameInput.trim();
            this.profile.avatar = `https://ui-avatars.com/api/?name=${encodeURIComponent(this.profile.name)}&background=random`;
            await DB.put('profile', this.profile);
            this.updateProfileUI();
        }
        UI.closeModals();
    },

    // Optional constraint: render top 50 matches for performance
    renderNotesList(filter = '') {
        this.els.notesList.innerHTML = '';
        
        let renderedCount = 0;
        for (let note of this.notes) {
            if (filter && !note.title.toLowerCase().includes(filter) && !note.snippet.toLowerCase().includes(filter)) {
                continue;
            }
            
            // Limit render for performance
            if (renderedCount > 50) break;
            
            const div = document.createElement('div');
            div.className = `note-card ${this.activeNoteId === note.id ? 'active' : ''}`;
            div.id = `card-${note.id}`;
            
            const d = new Date(note.lastModified);
            const dateStr = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }).toUpperCase();
            
            div.innerHTML = `
                <div class="note-card-date">${dateStr}</div>
                <div class="note-card-title">${note.title || 'Untitled Note'}</div>
                <div class="note-card-snippet">${note.snippet || 'No additional text'}</div>
                <div class="note-card-tags">
                    ${note.tags.map(t => `<span class="tag">${t}</span>`).join('')}
                </div>
            `;
            div.onclick = () => this.openNote(note.id);
            this.els.notesList.appendChild(div);
            renderedCount++;
        }
    },

    updateActiveNoteTitleInList() {
        if(!this.activeNoteId) return;
        const card = document.getElementById(`card-${this.activeNoteId}`);
        if(card) {
            const titleEl = card.querySelector('.note-card-title');
            if(titleEl) {
                titleEl.innerText = this.els.titleInput.value || 'Untitled Note';
            }
        }
    },

    async createNewNote() {
        const newNote = {
            id: 'note_' + Date.now(),
            title: '',
            content: '',
            snippet: '',
            tags: ['Daily', 'Draft'],
            dateCreated: Date.now(),
            lastModified: Date.now(),
            attachments: {}
        };
        this.notes.unshift(newNote); // Add to beginning
        await this.saveToDB(newNote);
        this.renderNotesList();
        this.openNote(newNote.id);
    },

    openNote(id) {
        if(this.activeNoteId === id) return;
        
        // Remove active class from previous
        if(this.activeNoteId) {
            const prev = document.getElementById(`card-${this.activeNoteId}`);
            if(prev) prev.classList.remove('active');
        }

        this.activeNoteId = id;
        const note = this.notes.find(n => n.id === id);
        if (!note) return;

        // Add active class
        const current = document.getElementById(`card-${this.activeNoteId}`);
        if(current) current.classList.add('active');

        this.els.editorEmpty.style.display = 'none';
        this.els.titleInput.value = note.title;
        document.getElementById('breadcrumb-text').innerHTML = `
            <button class="tool-btn" id="mobile-menu-btn" style="display:none; margin-right:8px;" onclick="UI.toggleSidebar()"><i class="ph ph-list"></i></button>
            My Notes > ${note.title || 'Untitled'}`;

        this.els.content.innerHTML = note.content;
        
        // Active state for mobile
        document.getElementById('editor-pane').classList.add('active');
        
        // Restore attachment blob URLs
        this.restoreAttachmentURLs(note);

        this.updateMetaDate(note.lastModified);

        // Tags
        this.renderTags(note.tags);
    },

    updateMetaDate(timestamp) {
        const d = new Date(timestamp);
        document.getElementById('meta-date').innerText = d.toLocaleString('en-GB', { day: 'numeric', month: 'long', year:'numeric', hour:'2-digit', minute:'2-digit' }) + ' ' + (d.getHours() >= 12 ? 'PM' : 'AM');
    },

    renderTags(tags) {
        const tContainer = document.getElementById('meta-tags');
        tContainer.innerHTML = tags.map(t => `<span class="tag">${t}</span>`).join('') + '<button class="tag" style="background:none; border: 1px dashed var(--border-color); cursor:pointer;">+ Add new tag</button>';
    },

    async saveCurrentNote() {
        if (!this.activeNoteId) return;
        const note = this.notes.find(n => n.id === this.activeNoteId);
        if (!note) return;

        note.title = this.els.titleInput.value.trim();
        note.content = this.els.content.innerHTML;
        note.snippet = this.els.content.innerText.substring(0, 100).replace(/\n/g, ' ');
        note.lastModified = Date.now();

        this.updateMetaDate(note.lastModified);
        
        // Render Note List to update snippet if needed without full recreation, but full render is safer for sorting
        // Let's just update the snippet in the DOM
        const card = document.getElementById(`card-${this.activeNoteId}`);
        if(card) {
            const snipEl = card.querySelector('.note-card-snippet');
            if(snipEl) snipEl.innerText = note.snippet || 'No additional text';
        }

        // Move note to top in memory because it's modified (if it's not already)
        this.notes.sort((a,b) => b.lastModified - a.lastModified);
        
        await this.saveToDB(note);
    },

    async saveToDB(note) {
        await DB.put('notes', Object.assign({}, note)); // Deep copy avoiding proxy issues
    },

    async deleteActiveNote() {
        if (!this.activeNoteId) return;
        document.getElementById('delete-modal').classList.add('active');
    },

    async performDelete() {
        if (!this.activeNoteId) return;
        
        await DB.delete('notes', this.activeNoteId);
        this.notes = this.notes.filter(n => n.id !== this.activeNoteId);
        this.activeNoteId = null;
        this.els.editorEmpty.style.display = 'flex';
        this.els.titleInput.value = '';
        this.els.content.innerHTML = '';
        this.renderNotesList();
        
        UI.closeModals();
        UI.closeEditor();
    },

    async handleFiles(files) {
        if (!this.activeNoteId || files.length === 0) return;
        const note = this.notes.find(n => n.id === this.activeNoteId);
        if (!note.attachments) note.attachments = {};
        
        for (let file of files) {
            const fileId = 'file_' + Date.now() + Math.random().toString(36).substr(2, 5);
            note.attachments[fileId] = {
                type: file.type,
                name: file.name,
                size: file.size,
                data: file // Store Blob in memory, then DB
            };

            // Create temporary URL for immediate render
            const url = URL.createObjectURL(file);
            let html = '';
            
            if (file.type.startsWith('image/')) {
                html = `<img src="${url}" data-file-id="${fileId}" class="attachment-image" style="max-width:100%; border-radius:8px; display:block; margin: 16px 0; cursor:pointer;" onclick="UI.previewMedia('${url}', 'image')" />`;
            } else if (file.type.startsWith('video/')) {
                // lazy render for videos (preload metadata only)
                html = `<video controls src="${url}" data-file-id="${fileId}" preload="metadata" style="max-width:100%; border-radius:8px; display:block; margin: 16px 0; max-height:400px; cursor:pointer;" onclick="UI.previewMedia('${url}', 'video')"></video>`;
            } else {
                html = `<div contenteditable="false" class="attachment-file" data-file-id="${fileId}">
                            <i class="ph ph-file" style="font-size:24px; color:var(--text-main);"></i>
                            <div>
                                <div style="font-weight:600; font-size:14px; color:var(--text-main);">${file.name}</div>
                                <div style="font-size:12px; color:var(--text-muted);">${(file.size/1024).toFixed(1)} KB</div>
                            </div>
                        </div>`;
            }
            
            // Insert into caret position
            this.els.content.focus();
            document.execCommand('insertHTML', false, html + '<p><br></p>');
        }
        
        // Reset file input
        this.els.fileInput.value = '';
        this.saveCurrentNote();
    },

    restoreAttachmentURLs(note) {
        if(!note.attachments) return;
        // Search content for file elements and update their SRC with a fresh Blob URL
        const elements = this.els.content.querySelectorAll('[data-file-id]');
        elements.forEach(el => {
            const id = el.getAttribute('data-file-id');
            const fileData = note.attachments[id];
            if(fileData && fileData.data) {
                const url = URL.createObjectURL(fileData.data);
                if (el.tagName === 'IMG' || el.tagName === 'VIDEO') {
                    // Update src if missing or pointing to dead blob URL
                    el.src = url;
                }
            }
        });
    }

};

/**
 * UI simple interactions
 */
const UI = {
    openProfileModal() {
        document.getElementById('profile-modal').classList.add('active');
        document.getElementById('profile-name-input').value = App.profile.name;
    },
    closeModals() {
        document.querySelectorAll('.modal-overlay').forEach(el => el.classList.remove('active'));
    },
    previewMedia(url, type) {
        const c = document.getElementById('preview-content');
        if(type === 'image') {
            c.innerHTML = `<img src="${url}" style="max-width:100%; max-height:80vh; border-radius:8px;" />`;
        } else if (type === 'video') {
            c.innerHTML = `<video controls autoplay src="${url}" style="max-width:100%; max-height:80vh; border-radius:8px;"></video>`;
        }
        document.getElementById('preview-modal').classList.add('active');
    },
    toggleSidebar() {
        document.querySelector('.sidebar').classList.toggle('active');
    },
    closeEditor() {
        document.getElementById('editor-pane').classList.remove('active');
    }
};

window.onload = () => {
    App.init();
};
