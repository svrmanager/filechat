import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getFirestore, collection, doc, setDoc, getDoc, getDocs, addDoc, updateDoc, deleteDoc, query, where, onSnapshot, orderBy, limit, serverTimestamp, arrayUnion, arrayRemove, deleteField } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const firebaseConfig = {
    apiKey: "AIzaSyCsqwNfi53mnOsNX6lXuOrKMWqMLcmoP_g",
    authDomain: "pvt-chat-bc438.firebaseapp.com",
    projectId: "pvt-chat-bc438",
    storageBucket: "pvt-chat-bc438.firebasestorage.app",
    messagingSenderId: "556863388234",
    appId: "1:556863388234:web:31b54ef1f79a03576804b3",
    measurementId: "G-SV7RFSVM45"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const cloudinaryConfig = { cloudName: "dbg9nbbzh", uploadPreset: "themin" };

let currentUser = null; let currentUserData = null;
let currentChatId = null; let currentChatData = null;
let unsubscribeMessages = null; let unsubscribeChats = null;

let messageLimit = 20;
let isFetchingMore = false;
let currentMediaGallery = [];
let currentLightboxIndex = 0;
let chatMessagesData = [];
let pendingUploads = new Map();
let kickTimerInterval = null;

// --- UI KUSTOM RINGAN ---
window.showToast = (msg, type = 'default') => {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`; toast.innerText = msg;
    container.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
};

window.showConfirm = (message, onYes, requireInput = false) => {
    document.getElementById('confirm-message').innerText = message;
    const inputArea = document.getElementById('confirm-input-area');
    const inputVal = document.getElementById('confirm-input-val');
    const inputUnit = document.getElementById('confirm-input-unit');
    
    if (requireInput) { inputArea.style.display = 'flex'; inputVal.value = ''; } 
    else { inputArea.style.display = 'none'; }

    const modal = document.getElementById('modal-confirm');
    modal.style.display = 'flex';
    
    const btnYes = document.getElementById('btn-confirm-yes');
    const btnNo = document.getElementById('btn-confirm-cancel');
    
    const newBtnYes = btnYes.cloneNode(true);
    const newBtnNo = btnNo.cloneNode(true);
    btnYes.parentNode.replaceChild(newBtnYes, btnYes);
    btnNo.parentNode.replaceChild(newBtnNo, btnNo);

    newBtnNo.onclick = () => { modal.style.display = 'none'; };
    newBtnYes.onclick = () => { 
        if(requireInput && (!inputVal.value || inputVal.value <= 0)) {
            showToast("Masukkan angka yang valid!", "error"); return;
        }
        modal.style.display = 'none'; 
        if(requireInput) onYes({ value: parseFloat(inputVal.value), unit: inputUnit.value });
        else onYes(); 
    };
};

async function generateUniqueGroupCode() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let code = ''; let exists = true;
    while(exists) {
        code = ''; for(let i=0; i<4; i++) code += chars.charAt(Math.floor(Math.random() * chars.length));
        const q = query(collection(db, "chats"), where("groupCode", "==", code));
        const snap = await getDocs(q);
        if(snap.empty) exists = false;
    }
    return code;
}

// --- LIGHTBOX GALLERY ---
window.openLightbox = (index) => {
    if(currentMediaGallery.length === 0) return;
    currentLightboxIndex = index;
    renderLightboxContent();
    document.getElementById('lightbox').style.display = 'flex';
};
window.closeLightbox = () => {
    document.getElementById('lightbox').style.display = 'none';
    document.getElementById('lightbox-content').innerHTML = '';
};
window.navigateLightbox = (dir) => {
    currentLightboxIndex += dir;
    if(currentLightboxIndex < 0) currentLightboxIndex = currentMediaGallery.length - 1;
    if(currentLightboxIndex >= currentMediaGallery.length) currentLightboxIndex = 0;
    renderLightboxContent();
};
function renderLightboxContent() {
    const media = currentMediaGallery[currentLightboxIndex];
    const content = document.getElementById('lightbox-content');
    if(media.type === 'video') content.innerHTML = `<video src="${media.url}" controls autoplay></video>`;
    else content.innerHTML = `<img src="${media.url}">`;
    document.getElementById('lightbox-counter').innerText = `${currentLightboxIndex + 1} / ${currentMediaGallery.length}`;
}

// --- FUNGSI CLOUDINARY PROGRESS BAR (XHR) ---
function uploadToCloudinary(file, onProgress, xhrRef = {}) {
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest(); xhrRef.xhr = xhr; 
        const fd = new FormData();
        fd.append('upload_preset', cloudinaryConfig.uploadPreset);
        fd.append('file', file);
        xhr.upload.onprogress = (e) => {
            if (e.lengthComputable && onProgress) {
                const percent = Math.round((e.loaded / e.total) * 100);
                onProgress(percent);
            }
        };
        xhr.onload = () => {
            if (xhr.status >= 200 && xhr.status < 300) {
                const data = JSON.parse(xhr.responseText);
                resolve({ url: data.secure_url, type: data.resource_type });
            } else { reject(new Error("Cloudinary Error")); }
        };
        xhr.onerror = () => reject(new Error("Network Error"));
        xhr.open('POST', `https://api.cloudinary.com/v1_1/${cloudinaryConfig.cloudName}/auto/upload`);
        xhr.send(fd);
    });
}

function getUserColor(uid) {
    const colors = ['#e53935', '#d81b60', '#8e24aa', '#3949ab', '#1e88e5', '#00897b', '#43a047'];
    let hash = 0; for (let i = 0; i < uid.length; i++) hash = uid.charCodeAt(i) + ((hash << 5) - hash);
    return colors[Math.abs(hash) % colors.length];
}
function getAvatarHTML(photoURL, nameStr) {
    if (photoURL) return `<img src="${photoURL}">`;
    return nameStr.charAt(0).toUpperCase();
}

// --- AUTENTIKASI ---
let isLoginMode = true;
const authBtn = document.getElementById('auth-btn');

document.getElementById('auth-toggle-btn').addEventListener('click', () => {
    isLoginMode = !isLoginMode;
    document.getElementById('auth-title').innerText = isLoginMode ? "Masuk ke Chat" : "Daftar Akun Baru";
    document.getElementById('auth-username').style.display = isLoginMode ? "none" : "block";
    authBtn.innerText = isLoginMode ? "Masuk" : "Daftar";
    document.getElementById('auth-toggle-btn').innerText = isLoginMode ? "Belum punya akun? Daftar di sini" : "Sudah punya akun? Masuk di sini";
});

authBtn.addEventListener('click', async () => {
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value;
    const username = document.getElementById('auth-username').value.trim();
    if(!email || !password) return showToast("Email dan Password wajib diisi!", "error");
    authBtn.disabled = true; authBtn.innerText = "Memproses...";

    try {
        if(isLoginMode) {
            await signInWithEmailAndPassword(auth, email, password);
        } else {
            if(!username) throw new Error("Username wajib diisi!");
            const q = query(collection(db, "users"), where("username", "==", username));
            if(!(await getDocs(q)).empty) throw new Error("Username sudah dipakai!");

            const userCred = await createUserWithEmailAndPassword(auth, email, password);
            await setDoc(doc(db, "users", userCred.user.uid), {
                uid: userCred.user.uid, email: email, username: username, photoURL: null, createdAt: serverTimestamp()
            });
        }
    } catch (error) {
        let msg = error.message;
        if(msg.includes('email-already-in-use')) msg = 'Email sudah terdaftar!';
        if(msg.includes('invalid-credential')) msg = 'Data tidak valid!';
        showToast(msg, "error");
    } finally { authBtn.disabled = false; authBtn.innerText = isLoginMode ? "Masuk" : "Daftar"; }
});

document.getElementById('logout-btn').addEventListener('click', () => { 
    showConfirm("Keluar dari akun?", () => { document.getElementById('modal-profile').style.display = 'none'; signOut(auth); });
});

document.getElementById('profile-trigger').addEventListener('click', () => {
    if(currentUserData) {
        document.getElementById('profile-modal-avatar').innerHTML = getAvatarHTML(currentUserData.photoURL, currentUserData.username);
        document.getElementById('profile-modal-username').innerText = currentUserData.username;
        document.getElementById('profile-modal-email').innerText = currentUserData.email;
        document.getElementById('modal-profile').style.display = 'flex';
    }
});

document.getElementById('user-pp-input').addEventListener('change', async (e) => {
    if(e.target.files.length > 0) {
        showToast("Mengunggah foto profil...");
        try {
            const res = await uploadToCloudinary(e.target.files[0]);
            if(res.url) {
                await updateDoc(doc(db, "users", currentUser.uid), { photoURL: res.url });
                const qChats = query(collection(db, "chats"), where("participants", "array-contains", currentUser.uid));
                const snap = await getDocs(qChats);
                snap.forEach(d => { if(d.data().type === 'direct') updateDoc(doc(db, "chats", d.id), { [`participantPhotos.${currentUser.uid}`]: res.url }); });
                currentUserData.photoURL = res.url;
                document.getElementById('profile-modal-avatar').innerHTML = getAvatarHTML(res.url, currentUserData.username);
                document.getElementById('my-avatar').innerHTML = getAvatarHTML(res.url, currentUserData.username);
                showToast("Foto profil diperbarui!", "success");
            } else { throw new Error(); }
        } catch(e) { showToast("Gagal unggah foto.", "error"); }
        e.target.value = '';
    }
});

onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;
        let userDoc = await getDoc(doc(db, "users", user.uid));
        if(userDoc.exists()) {
            currentUserData = userDoc.data();
            document.getElementById('current-user-info').innerText = `@${currentUserData.username}`;
            document.getElementById('my-avatar').innerHTML = getAvatarHTML(currentUserData.photoURL, currentUserData.username);
            document.getElementById('auth-screen').style.display = 'none';
            document.getElementById('main-app').style.display = 'flex';
            loadChats();
        }
    } else {
        currentUser = null; currentUserData = null;
        document.getElementById('auth-screen').style.display = 'flex';
        document.getElementById('main-app').style.display = 'none';
        if(unsubscribeChats) unsubscribeChats();
        if(unsubscribeMessages) unsubscribeMessages();
    }
});

// --- MANAJEMEN KONTAK ---
async function findUser(target) {
    const q = query(collection(db, "users"), where("username", "==", target));
    let snap = await getDocs(q);
    if(snap.empty) snap = await getDocs(query(collection(db, "users"), where("email", "==", target)));
    return snap.empty ? null : snap.docs[0].data();
}

window.startDirectChat = async (targetUid, targetUsername, targetPhoto = null) => {
    if(targetUid === currentUser.uid) return;
    const q = query(collection(db, "chats"), where("type", "==", "direct"), where("participants", "array-contains", currentUser.uid));
    const snap = await getDocs(q);
    let existingChatId = null;
    snap.forEach(d => { if(d.data().participants.includes(targetUid)) existingChatId = d.id; });

    if(existingChatId) {
        const chatD = (await getDoc(doc(db, "chats", existingChatId))).data();
        openChat(existingChatId, chatD, targetUsername, targetPhoto);
    } else {
        const docRef = await addDoc(collection(db, "chats"), {
            type: "direct", participants: [currentUser.uid, targetUid],
            participantNames: { [currentUser.uid]: currentUserData.username, [targetUid]: targetUsername },
            participantPhotos: { [currentUser.uid]: currentUserData.photoURL || null, [targetUid]: targetPhoto },
            lastUpdate: serverTimestamp()
        });
        const chatD = (await getDoc(docRef)).data();
        openChat(docRef.id, chatD, targetUsername, targetPhoto);
    }
};

document.getElementById('btn-add-contact').addEventListener('click', async () => {
    const target = document.getElementById('contact-target').value.trim();
    if(!target) return;
    
    if(/^[a-zA-Z]{4}$/.test(target)) {
        const groupCode = target.toUpperCase();
        const qGroup = query(collection(db, "chats"), where("groupCode", "==", groupCode));
        const snapGroup = await getDocs(qGroup);
        if(!snapGroup.empty) {
            const groupDoc = snapGroup.docs[0]; const groupData = groupDoc.data();
            if(groupData.participants.includes(currentUser.uid)) {
                showToast("Anda sudah berada di grup ini!", "default");
            } else {
                const newNames = { ...groupData.participantNames }; newNames[currentUser.uid] = currentUserData.username;
                await updateDoc(doc(db, "chats", groupDoc.id), { 
                    participants: arrayUnion(currentUser.uid), participantNames: newNames, [`scheduledKicks.${currentUser.uid}`]: deleteField()
                });
                showToast(`Berhasil bergabung ke grup: ${groupData.name}!`, "success");
            }
            document.getElementById('modal-add-contact').style.display = 'none'; document.getElementById('contact-target').value = '';
            return;
        }
    }

    const targetUser = await findUser(target);
    if(!targetUser) return showToast("Pengguna/Kode tidak ditemukan!", "error");
    if(targetUser.uid === currentUser.uid) return showToast("Ini akun Anda sendiri!", "error");
    
    await window.startDirectChat(targetUser.uid, targetUser.username, targetUser.photoURL);
    document.getElementById('modal-add-contact').style.display = 'none'; document.getElementById('contact-target').value = '';
});

document.getElementById('btn-create-group').addEventListener('click', async () => {
    const gName = document.getElementById('group-name-input').value.trim();
    if(!gName) return showToast("Isi nama grup!", "error");
    
    document.getElementById('btn-create-group').innerText = "Membuat...";
    document.getElementById('btn-create-group').disabled = true;

    const newCode = await generateUniqueGroupCode();
    await addDoc(collection(db, "chats"), {
        type: "group", name: gName, photoURL: null, participants: [currentUser.uid], admins: [currentUser.uid],
        participantNames: { [currentUser.uid]: currentUserData.username }, groupCode: newCode, lastUpdate: serverTimestamp()
    });
    
    showToast("Grup dibuat!", "success");
    document.getElementById('modal-create-group').style.display = 'none'; document.getElementById('group-name-input').value = '';
    document.getElementById('btn-create-group').innerText = "Buat Grup"; document.getElementById('btn-create-group').disabled = false;
});

function loadChats() {
    if(unsubscribeChats) unsubscribeChats();
    const q = query(collection(db, "chats"), where("participants", "array-contains", currentUser.uid));
    unsubscribeChats = onSnapshot(q, (snapshot) => {
        const chatList = document.getElementById('chat-list'); chatList.innerHTML = '';
        let arr = [];
        snapshot.forEach(d => { arr.push({ id: d.id, ...d.data() }); });
        arr.sort((a, b) => (b.lastUpdate ? b.lastUpdate.toMillis() : Date.now()) - (a.lastUpdate ? a.lastUpdate.toMillis() : Date.now()));

        arr.forEach(chat => {
            let name = chat.type === 'group' ? chat.name : "Personal";
            let photo = chat.type === 'group' ? chat.photoURL : null;
            if(chat.type === 'direct') {
                const other = chat.participants.find(id => id !== currentUser.uid);
                name = chat.participantNames[other] || "User";
                if(chat.participantPhotos) photo = chat.participantPhotos[other];
            }
            const div = document.createElement('div');
            div.className = `chat-list-item ${currentChatId === chat.id ? 'active' : ''}`;
            div.innerHTML = `<div class="avatar">${getAvatarHTML(photo, name)}</div><div class="chat-info"><h4>${name}</h4><p>${chat.lastMessage || '...'}</p></div>`;
            div.onclick = () => openChat(chat.id, chat, name, photo);
            chatList.appendChild(div);
        });
    });
}

// --- RENDER PESAN & ALBUM MEDIA ---
window.openChat = async (chatId, chatData, name, photoUrl) => {
    currentChatId = chatId; currentChatData = chatData;
    messageLimit = 20; pendingUploads.clear();
    
    document.getElementById('chat-header').style.display = 'flex';
    document.getElementById('chat-input-area').style.display = 'flex';
    document.getElementById('chat-header-name').innerText = name;
    document.getElementById('chat-header-avatar').innerHTML = getAvatarHTML(photoUrl, name);
    document.getElementById('group-actions').style.display = chatData.type === 'group' ? 'block' : 'none';
    document.querySelectorAll('.chat-list-item').forEach(el => el.classList.remove('active'));
    
    checkAndExecuteKicks(chatId);
    subscribeToMessages();
};

function handleKickBanner(chatData) {
    if(kickTimerInterval) clearInterval(kickTimerInterval);
    const banner = document.getElementById('kick-warning-banner');
    const countdownTxt = document.getElementById('kick-countdown');
    
    if(chatData.type === 'group' && chatData.scheduledKicks && chatData.scheduledKicks[currentUser.uid]) {
        banner.style.display = 'block';
        const targetTime = chatData.scheduledKicks[currentUser.uid];
        
        kickTimerInterval = setInterval(() => {
            const now = Date.now();
            if (now >= targetTime) { clearInterval(kickTimerInterval); banner.style.display = 'none'; return; }
            const diff = targetTime - now;
            const h = Math.floor(diff / 3600000).toString().padStart(2, '0');
            const m = Math.floor((diff % 3600000) / 60000).toString().padStart(2, '0');
            const s = Math.floor((diff % 60000) / 1000).toString().padStart(2, '0');
            countdownTxt.innerText = `${h}:${m}:${s}`;
        }, 1000);
    } else { banner.style.display = 'none'; }
}

async function checkAndExecuteKicks(chatId) {
    const chatDoc = await getDoc(doc(db, "chats", chatId));
    if(!chatDoc.exists()) return; const data = chatDoc.data();
    if(data.type !== 'group' || !data.scheduledKicks) return;

    const now = Date.now();
    for (const [uid, time] of Object.entries(data.scheduledKicks)) {
        if (now >= time) {
            await updateDoc(doc(db, "chats", chatId), { participants: arrayRemove(uid), [`scheduledKicks.${uid}`]: deleteField() });
            if(uid === currentUser.uid) {
                currentChatId = null;
                document.getElementById('chat-header').style.display = 'none'; document.getElementById('chat-input-area').style.display = 'none';
                document.getElementById('chat-messages').innerHTML = '<p style="text-align: center; color: #ea4335; margin-top: 50px;">Anda dikeluarkan dari grup.</p>';
            }
        }
    }
}

const chatWindow = document.getElementById('chat-messages');
chatWindow.addEventListener('scroll', () => {
    if (chatWindow.scrollTop === 0 && !isFetchingMore) {
        messageLimit += 20; isFetchingMore = true;
        document.getElementById('loading-more').style.display = 'block';
        subscribeToMessages(true);
    }
});

function subscribeToMessages(maintainScroll = false) {
    if(unsubscribeMessages) unsubscribeMessages();
    const q = query(collection(db, "chats", currentChatId, "messages"), orderBy("timestamp", "desc"), limit(messageLimit));
    
    onSnapshot(doc(db, "chats", currentChatId), (docSnap) => {
        if(docSnap.exists()) { currentChatData = docSnap.data(); handleKickBanner(currentChatData); }
    });

    unsubscribeMessages = onSnapshot(q, (snapshot) => {
        chatMessagesData = [];
        snapshot.forEach(docSnap => { chatMessagesData.push({ id: docSnap.id, ...docSnap.data() }); });
        chatMessagesData.reverse();
        renderAllMessages(maintainScroll);
    });
}

window.askDirectChat = (uid, name) => {
    if(uid === currentUser.uid) return;
    showConfirm(`Kirim pesan personal ke ${name}?`, () => { window.startDirectChat(uid, name); });
};

// FITUR BARU: Hapus Banyak Sekaligus (Batch)
window.deleteMsgBatch = (idsString) => {
    showConfirm("Hapus semua media di kelompok ini?", async () => {
        const ids = idsString.split(',');
        for(let id of ids) {
            try { await deleteDoc(doc(db, "chats", currentChatId, "messages", id)); } catch(e) {}
        }
    });
};

function renderAllMessages(maintainScroll = false) {
    const oldScrollHeight = chatWindow.scrollHeight;
    chatWindow.innerHTML = '';
    currentMediaGallery = [];
    
    // 1. Group Firestore Messages (Berdasarkan batchId & senderId)
    let groupedMessages = [];
    chatMessagesData.forEach(msg => {
        if (msg.batchId && groupedMessages.length > 0) {
            let lastGroup = groupedMessages[groupedMessages.length - 1];
            if (lastGroup.batchId === msg.batchId && lastGroup.senderId === msg.senderId) {
                if(msg.mediaUrl) lastGroup.mediaList.push({ url: msg.mediaUrl, type: msg.mediaType, id: msg.id });
                return;
            }
        }
        let newGroup = { ...msg, mediaList: [] };
        if (msg.mediaUrl) newGroup.mediaList.push({ url: msg.mediaUrl, type: msg.mediaType, id: msg.id });
        groupedMessages.push(newGroup);
    });

    // 2. Group Pending Uploads (Agar tampilan Grid berfungsi sebelum selesai upload)
    let groupedPending = [];
    pendingUploads.forEach((data, uploadId) => {
        if (data.batchId && groupedPending.length > 0) {
            let lastGroup = groupedPending[groupedPending.length - 1];
            if (lastGroup.batchId === data.batchId) { lastGroup.uploads.push({ uploadId, ...data }); return; }
        }
        groupedPending.push({ batchId: data.batchId, uploads: [{ uploadId, ...data }] });
    });

    let lastDate = null; let localCounter = 0;

    // Render Data yang Sudah Sukses di Database
    groupedMessages.forEach(msg => {
        const isMine = msg.senderId === currentUser.uid;
        const dateObj = msg.timestamp ? msg.timestamp.toDate() : new Date();
        const timeStr = dateObj.getHours().toString().padStart(2, '0') + ':' + dateObj.getMinutes().toString().padStart(2, '0');
        const currentDate = dateObj.toLocaleDateString('id-ID', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

        if (currentDate !== lastDate) {
            const sep = document.createElement('div'); sep.className = 'date-separator'; sep.innerText = currentDate;
            chatWindow.appendChild(sep); lastDate = currentDate;
        }

        const msgDiv = document.createElement('div');
        msgDiv.className = `message ${isMine ? 'sent' : 'received'}`;
        let html = '';
        
        if(!isMine && currentChatData.type === 'group') {
            html += `<div class="sender-name" style="color: ${getUserColor(msg.senderId)}" onclick="window.askDirectChat('${msg.senderId}', '${msg.senderName}')">${msg.senderName}</div>`;
        }
        
        // RENDER ALBUM MEDIA
        if(msg.mediaList.length > 0) {
            let countClass = msg.mediaList.length >= 4 ? 4 : msg.mediaList.length;
            html += `<div class="media-album" data-count="${countClass}">`;
            msg.mediaList.forEach(media => {
                currentMediaGallery.push({ url: media.url, type: media.type });
                const idx = localCounter;
                html += `<div class="media-container" onclick="openLightbox(${idx})">`;
                if(media.type === 'video') html += `<video src="${media.url}"></video><div class="play-icon-overlay">▶</div>`;
                else html += `<img src="${media.url}" loading="lazy">`;
                html += `</div>`;
                localCounter++;
            });
            html += `</div>`;
        }
        
        if(msg.text) html += `<p>${msg.text}</p>`;
        html += `<div class="time-row"><span class="time">${timeStr}</span>`;
        if(isMine) {
            // Tombol Hapus Grup (Bisa 1 atau banyak)
            const idsToDelete = msg.mediaList.length > 0 ? msg.mediaList.map(m => m.id).join(',') : msg.id;
            html += `<button class="btn-delete-msg" onclick="window.deleteMsgBatch('${idsToDelete}')">🗑️</button>`;
        }
        html += `</div>`;

        msgDiv.innerHTML = html; chatWindow.appendChild(msgDiv);
    });

    // Render Data Pending Uploads
    groupedPending.forEach(group => {
        const msgDiv = document.createElement('div');
        msgDiv.className = `message sent`;
        let countClass = group.uploads.length >= 4 ? 4 : group.uploads.length;
        
        let html = `<div class="media-album" data-count="${countClass}">`;
        group.uploads.forEach(up => {
            const isVid = up.file.type.startsWith('video');
            html += `
            <div class="media-container" style="cursor: default;">
                ${isVid ? `<video src="${up.previewUrl}"></video>` : `<img src="${up.previewUrl}">`}
                <div class="uploading-overlay">
                    <span id="txt_${up.uploadId}" style="font-weight:bold;">0%</span>
                    <div class="progress-bar-container"><div class="progress-bar-fill" id="bar_${up.uploadId}"></div></div>
                    <button class="btn-cancel-upload" onclick="window.cancelUpload('${up.uploadId}')">Batal ✖</button>
                </div>
            </div>`;
        });
        html += `</div><div class="time-row"><span class="time">...</span></div>`;
        
        msgDiv.innerHTML = html; chatWindow.appendChild(msgDiv);
    });

    document.getElementById('loading-more').style.display = 'none';

    if(maintainScroll && isFetchingMore) {
        chatWindow.scrollTop = chatWindow.scrollHeight - oldScrollHeight;
        isFetchingMore = false;
    } else {
        chatWindow.scrollTop = chatWindow.scrollHeight;
    }
}

// --- UPLOAD LATAR BELAKANG BATCH PER-15 MEDIA ---
const fileInput = document.getElementById('file-input');

fileInput.addEventListener('change', (e) => {
    const files = Array.from(e.target.files);
    if(files.length > 0) processBackgroundUploads(files);
    fileInput.value = ""; 
});

window.cancelUpload = (uploadId) => {
    const pending = pendingUploads.get(uploadId);
    if(pending) {
        if(pending.xhrRef.xhr) pending.xhrRef.xhr.abort();
        URL.revokeObjectURL(pending.previewUrl);
        pendingUploads.delete(uploadId);
        renderAllMessages();
    }
};

async function processBackgroundUploads(files) {
    if(!currentChatId) return;
    
    // PEMBAGIAN KELOMPOK (Maksimal 15 per grup)
    const CHUNK_SIZE = 15;
    
    for (let i = 0; i < files.length; i += CHUNK_SIZE) {
        const chunk = files.slice(i, i + CHUNK_SIZE);
        const batchId = 'batch_' + Date.now() + '_' + Math.random().toString(36).substr(2,5);
        const currentQueue = [];
        
        chunk.forEach(file => {
            const uploadId = 'up_' + Date.now() + '_' + Math.random().toString(36).substr(2,5);
            const previewUrl = URL.createObjectURL(file);
            pendingUploads.set(uploadId, { file, previewUrl, batchId, xhrRef: {} });
            currentQueue.push(uploadId);
        });
        
        renderAllMessages(); 

        for(const uploadId of currentQueue) {
            const pending = pendingUploads.get(uploadId);
            if(!pending) continue; 

            try {
                const onProgress = (percent) => {
                    const txt = document.getElementById(`txt_${uploadId}`);
                    const bar = document.getElementById(`bar_${uploadId}`);
                    if(txt && bar) { txt.innerText = `${percent}%`; bar.style.width = `${percent}%`; }
                };

                const res = await uploadToCloudinary(pending.file, onProgress, pending.xhrRef);
                if(res.url) {
                    await addDoc(collection(db, "chats", currentChatId, "messages"), {
                        senderId: currentUser.uid, senderName: currentUserData.username, text: null,
                        mediaUrl: res.url, mediaType: res.type, batchId: pending.batchId, timestamp: serverTimestamp()
                    });
                    await updateDoc(doc(db, "chats", currentChatId), { lastMessage: `📷 Media Album`, lastUpdate: serverTimestamp() });
                }
            } catch(err) {
                if(err.message !== 'AbortError' && err.message !== 'Network Error') showToast("Gagal mengirim file.", "error");
            } finally {
                URL.revokeObjectURL(pending.previewUrl);
                pendingUploads.delete(uploadId);
                renderAllMessages();
            }
        }
    }
}

document.getElementById('send-button').addEventListener('click', sendTextMessage);
document.getElementById('message-input').addEventListener('keypress', (e) => { if(e.key === 'Enter') sendTextMessage(); });

async function sendTextMessage() {
    if(!currentChatId) return;
    const input = document.getElementById('message-input');
    const text = input.value.trim();
    if(!text) return;

    input.value = ''; 
    await addDoc(collection(db, "chats", currentChatId, "messages"), {
        senderId: currentUser.uid, senderName: currentUserData.username, text: text,
        mediaUrl: null, mediaType: null, timestamp: serverTimestamp()
    });
    await updateDoc(doc(db, "chats", currentChatId), { lastMessage: text, lastUpdate: serverTimestamp() });
}

// --- ADMIN GRUP ---
document.getElementById('btn-group-info').addEventListener('click', () => {
    document.getElementById('modal-group-title').innerText = `Info Grup`;
    document.getElementById('modal-group-info').style.display = 'flex';
    
    const isAdmin = currentChatData.admins.includes(currentUser.uid);
    document.getElementById('admin-controls').style.display = isAdmin ? 'block' : 'none';
    if(isAdmin) {
        document.getElementById('edit-group-name').value = currentChatData.name;
        document.getElementById('display-group-code').innerText = currentChatData.groupCode || "----";
    }
    
    const listDiv = document.getElementById('group-members-list');
    let html = '';
    
    currentChatData.participants.forEach(id => {
        const isMemAdmin = currentChatData.admins.includes(id);
        const name = currentChatData.participantNames[id];
        const hasTimer = currentChatData.scheduledKicks && currentChatData.scheduledKicks[id];
        const timerBadge = hasTimer ? '<span style="color:#ea4335; font-size:0.7rem; margin-left:5px;">(⏳ Scheduled)</span>' : '';
        
        html += `<div class="member-list-item"><div>${name} ${isMemAdmin ? '<span class="badge-admin">Admin</span>' : ''} ${timerBadge}</div>`;
        
        if(isAdmin && !isMemAdmin) {
            html += `<div class="admin-actions">
                        <button class="btn-admin-action" title="Jadikan Admin" onclick="window.promote('${id}')">⭐</button>`;
            
            if (hasTimer) html += `<button class="btn-admin-action btn-admin-danger" title="Batalkan Kick" onclick="window.cancelKick('${id}', '${name}')">❌</button>`;
            else html += `<button class="btn-admin-action btn-admin-danger" title="Keluarkan Terjadwal" onclick="window.scheduleKick('${id}', '${name}')">⏱️</button>`;

            html += `<button class="btn-admin-action btn-admin-danger" title="Keluarkan Instan" onclick="window.kickUser('${id}', '${name}')">🚫</button></div>`;
        }
        html += `</div>`;
    });
    listDiv.innerHTML = html;
});

window.kickUser = (uid, name) => {
    showConfirm(`Keluarkan ${name} dari grup sekarang?`, async () => {
        await updateDoc(doc(db, "chats", currentChatId), { participants: arrayRemove(uid), [`scheduledKicks.${uid}`]: deleteField() });
        showToast(`${name} telah dikeluarkan.`, "success"); document.getElementById('modal-group-info').style.display = 'none';
    });
};

window.scheduleKick = (uid, name) => {
    showConfirm(`Atur waktu mundur untuk mengeluarkan ${name}:`, async (inputData) => {
        const multiplier = inputData.unit === 'hours' ? 3600000 : 60000;
        const kickTimestamp = Date.now() + (inputData.value * multiplier);
        await updateDoc(doc(db, "chats", currentChatId), { [`scheduledKicks.${uid}`]: kickTimestamp });
        showToast(`${name} akan dikeluarkan dalam ${inputData.value} ${inputData.unit === 'hours' ? 'jam' : 'menit'}.`, "success");
        document.getElementById('modal-group-info').style.display = 'none';
    }, true); 
};

window.cancelKick = (uid, name) => {
    showConfirm(`Batalkan pengeluaran terjadwal untuk ${name}?`, async () => {
        await updateDoc(doc(db, "chats", currentChatId), { [`scheduledKicks.${uid}`]: deleteField() });
        showToast(`Kick untuk ${name} dibatalkan.`, "success"); document.getElementById('modal-group-info').style.display = 'none';
    });
};

document.getElementById('btn-save-group-settings').addEventListener('click', async () => {
    const newName = document.getElementById('edit-group-name').value.trim();
    if(!newName) return showToast("Nama wajib diisi!", "error");
    
    let newPhotoUrl = currentChatData.photoURL;
    if(document.getElementById('edit-group-pp').files.length > 0) {
        showToast("Menyimpan...");
        try { const res = await uploadToCloudinary(document.getElementById('edit-group-pp').files[0]); if(res.url) newPhotoUrl = res.url; } catch(e) {}
    }
    await updateDoc(doc(db, "chats", currentChatId), { name: newName, photoURL: newPhotoUrl });
    showToast("Berhasil disimpan!", "success"); document.getElementById('modal-group-info').style.display = 'none';
});

window.promote = (memberId) => {
    showConfirm("Jadikan Admin?", async () => {
        await updateDoc(doc(db, "chats", currentChatId), { admins: arrayUnion(memberId) });
        showToast("Berhasil ditunjuk.", "success"); document.getElementById('modal-group-info').style.display = 'none';
    });
};

document.getElementById('btn-add-member').addEventListener('click', async () => {
    const target = document.getElementById('new-member-target').value.trim();
    if(!target) return;
    const targetUser = await findUser(target);
    if(!targetUser) return showToast("Tidak ditemukan!", "error");
    if(currentChatData.participants.includes(targetUser.uid)) return showToast("Sudah di grup!", "default");

    const newNames = { ...currentChatData.participantNames };
    newNames[targetUser.uid] = targetUser.username;
    await updateDoc(doc(db, "chats", currentChatId), { participants: arrayUnion(targetUser.uid), participantNames: newNames, [`scheduledKicks.${targetUser.uid}`]: deleteField() });
    showToast("Berhasil diundang!", "success");
    document.getElementById('new-member-target').value = ''; document.getElementById('modal-group-info').style.display = 'none';
});
