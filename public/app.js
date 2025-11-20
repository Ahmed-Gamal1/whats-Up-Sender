// app.js
const socket = io();

let selectedGroups = [];

let allGroups = [];

// استمع لحدث QR Code
socket.on('qr', (qrImage) => {
    console.log('📱 تم استلام QR Code');
    const qrContainer = document.getElementById('qrContainer');
    const qrImageEl = document.getElementById('qrImage');
    
    qrImageEl.src = qrImage;
    qrContainer.style.display = 'block';
    
    // إضافة animation
    qrContainer.style.animation = 'fadeInScale 0.5s ease-out';
});

// استمع لإخفاء QR Code
socket.on('qr_hide', () => {
    console.log('🔒 إخفاء QR Code');
    const qrContainer = document.getElementById('qrContainer');
    // إضافة fade out animation قبل الإخفاء
    qrContainer.style.animation = 'fadeOut 0.5s ease-out';
    setTimeout(() => {
        qrContainer.style.display = 'none';
    }, 500);
});

// استمع لحدث تغيير الحالة
socket.on('status', (status) => {
    const statusIcon = document.getElementById('statusIcon');
    const statusText = document.getElementById('statusText');
    const qrContainer = document.getElementById('qrContainer');
    
    if (status.connected) {
        statusIcon.textContent = '🟢';
        statusText.textContent = `متصل - ${status.groupsCount} جروب متاح`;
        // إخفاء QR Code فقط إذا كان متصل فعلاً
        if (qrContainer.style.display !== 'none') {
            setTimeout(() => {
                qrContainer.style.display = 'none';
            }, 500);
        }
        // إيقاف animation عند الاتصال
        statusIcon.style.animation = 'none';
    } else {
        // إذا كان في حالة authenticating، استخدم أيقونة مختلفة
        if (status.authenticating) {
            statusIcon.textContent = '🟡';
            statusText.textContent = status.message;
            statusIcon.style.animation = 'pulse 1.5s ease-in-out infinite';
            
            // إخفاء QR Code أثناء المصادقة
            if (status.showQR === false) {
                qrContainer.style.display = 'none';
            }
        } else {
            statusIcon.textContent = '🔴';
            statusText.textContent = status.message;
            // إعادة animation عند عدم الاتصال
            statusIcon.style.animation = 'bounce 1s ease-in-out infinite';
            
            // إظهار QR Code إذا كان موجوداً
            const qrImg = qrContainer.querySelector('img');
            if (status.showQR === true && qrImg && qrImg.src) {
                qrContainer.style.display = 'block';
            }
        }
    }
});

// استمع لحدث تحميل الجروبات
socket.on('groups_loaded', (groups) => {
    allGroups = groups;
    displayGroups(groups);
});

// عرض الجروبات
function displayGroups(groups) {
    const groupsList = document.getElementById('groupsList');
    const groupsCount = document.getElementById('groupsCount');
    
    groupsCount.textContent = `(${groups.length} جروب)`;
    
    if (groups.length === 0) {
        groupsList.innerHTML = '<div class="no-groups">❌ لا توجد جروبات متاحة</div>';
        return;
    }
    
    groupsList.innerHTML = '';
    
    groups.forEach(group => {
        const groupItem = document.createElement('div');
        groupItem.className = 'group-item';
        groupItem.innerHTML = `
            <input type="checkbox" id="group-${group.id}" value="${group.id}">
            <label for="group-${group.id}">
                <strong>${group.name}</strong>
                <span class="group-meta">(${group.participants} عضو)</span>
            </label>
        `;
        
        groupItem.querySelector('input').addEventListener('change', (e) => {
            if (e.target.checked) {
                selectedGroups.push(group.id);
            } else {
                selectedGroups = selectedGroups.filter(id => id !== group.id);
            }
            updateSendButton();
        });
        
        groupsList.appendChild(groupItem);
    });
}

// اختيار كل الجروبات
function selectAllGroups() {
    selectedGroups = allGroups.map(group => group.id);
    
    const checkboxes = document.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(checkbox => {
        checkbox.checked = true;
    });
    
    updateSendButton();
}

// إلغاء اختيار الكل
function deselectAllGroups() {
    selectedGroups = [];
    
    const checkboxes = document.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(checkbox => {
        checkbox.checked = false;
    });
    
    updateSendButton();
}

// تحديث الجروبات
function refreshGroups() {
    if (socket.connected) {
        socket.emit('get_groups');
    }
}

// تحديث حالة زر الإرسال
function updateSendButton() {
    const sendBtn = document.getElementById('sendBtn');
    const message = document.getElementById('message').value.trim();
    
    sendBtn.disabled = selectedGroups.length === 0 || message === '';
}

// إرسال التوصية
async function sendRecommendation() {
    const message = document.getElementById('message').value.trim();
    const sendBtn = document.getElementById('sendBtn');
    const status = document.getElementById('status');
    
    if (!message || selectedGroups.length === 0) {
        showStatus('⚠️ من فضلك اكتب التوصية واختر جروب واحد على الأقل', 'error');
        return;
    }
    
    sendBtn.disabled = true;
    sendBtn.innerHTML = '⏳ جاري الإرسال...';
    status.className = 'status';
    
    try {
        const response = await fetch('/api/broadcast', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                message: message,
                groups: selectedGroups
            })
        });
        
        const result = await response.json();
        
        if (result.success) {
            showStatus(`✅ تم الإرسال بنجاح لـ ${result.sent} جروب`, 'success');
            document.getElementById('message').value = '';
            selectedGroups = [];
            resetGroupSelection();
        } else {
            showStatus(`❌ حدث خطأ: ${result.error}`, 'error');
        }
    } catch (error) {
        showStatus('❌ خطأ في الاتصال بالسيرفر', 'error');
    } finally {
        sendBtn.disabled = false;
        sendBtn.innerHTML = '🚀 إرسال التوصية للجروبات المحددة';
    }
}

// عرض حالة الإرسال
function showStatus(message, type) {
    const status = document.getElementById('status');
    status.textContent = message;
    status.className = `status ${type}`;
}

// إعادة تعيين اختيار الجروبات
function resetGroupSelection() {
    const checkboxes = document.querySelectorAll('input[type="checkbox"]');
    checkboxes.forEach(checkbox => {
        checkbox.checked = false;
    });
}

// استمع لتغير نص الرسالة
document.getElementById('message').addEventListener('input', updateSendButton);