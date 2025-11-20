// server.js
const express = require('express');
const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: true
    },
    transports: ['polling', 'websocket'],
    allowEIO3: true
});

const PORT = process.env.PORT || 3000;

// CORS middleware
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    if (req.method === 'OPTIONS') {
        res.sendStatus(200);
    } else {
        next();
    }
});

app.use(express.json());
app.use(express.static('public'));

// حالة البوت
let client = null;
let isReady = false;
let qrCode = null;
let allGroups = [];

// تهيئة البوت مع حفظ الجلسة
function initializeWhatsApp() {
    // تنظيف أي عميل سابق
    if (client) {
        try {
            client.destroy();
        } catch (e) {
            console.log('⚠️ تنظيف العميل السابق:', e.message);
        }
        client = null;
    }

    client = new Client({
        authStrategy: new LocalAuth(), // يحفظ الجلسة تلقائياً
        puppeteer: {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu'
            ]
        },
        webVersionCache: {
            type: 'remote',
            remotePath: 'https://raw.githubusercontent.com/wppconnect-team/wa-version/main/html/2.2413.51.html',
        }
    });

    client.on('qr', async (qr) => {
        console.log('📱 QR Code received');
        qrCode = await qrcode.toDataURL(qr);
        // إرسال QR Code لجميع المستخدمين المتصلين
        io.emit('qr', qrCode);
        io.emit('status', { connected: false, message: 'امسح QR code', showQR: true });
        console.log('✅ تم إرسال QR Code لجميع المستخدمين');
    });

    // حدث عند بدء المصادقة (بعد scan QR Code)
    client.on('authenticated', () => {
        console.log('🔐 تم المصادقة - جاري الاتصال...');
        io.emit('status', { 
            connected: false, 
            message: 'تم مسح QR Code - جاري الاتصال...', 
            showQR: false,
            authenticating: true 
        });
        // إخفاء QR Code بعد تأكيد المصادقة
        setTimeout(() => {
            io.emit('qr_hide');
        }, 1000);
    });

    // حدث أثناء التحميل
    client.on('loading_screen', (percent, message) => {
        console.log(`⏳ جاري التحميل: ${percent}% - ${message}`);
        io.emit('status', { 
            connected: false, 
            message: `جاري التحميل: ${percent}% - ${message || 'يرجى الانتظار...'}`,
            authenticating: true,
            loadingPercent: percent
        });
    });

    client.on('ready', async () => {
        console.log('✅ WhatsApp connected!');
        isReady = true;
        qrCode = null;
        
        // إخفاء QR Code نهائياً
        io.emit('qr_hide');
        
        // إرسال حالة التحميل النهائية
        io.emit('status', { 
            connected: false, 
            message: 'جاري تحميل الجروبات...',
            authenticating: true,
            loadingPercent: 90
        });
        
        // جلب الجروبات تلقائياً عند الاتصال
        await loadGroups();
        
        // إرسال حالة الاتصال النهائية
        io.emit('status', { 
            connected: true, 
            message: 'متصل بـ WhatsApp',
            groupsCount: allGroups.length,
            authenticating: false
        });
        
        io.emit('groups_loaded', allGroups);
        
        // بدء التحديث التلقائي للجروبات كل 5 دقائق
        startAutoRefreshGroups();
    });

    client.on('auth_failure', (msg) => {
        console.log('❌ Auth failure', msg);
        isReady = false;
        io.emit('status', { connected: false, message: 'فشل المصادقة - جاري إعادة المحاولة...' });
        
        // إعادة المحاولة بعد 5 ثواني
        setTimeout(() => {
            console.log('🔄 إعادة محاولة بعد فشل المصادقة...');
            initializeWhatsApp();
        }, 5000);
    });

    // معالجة الأخطاء العامة
    client.on('error', (error) => {
        console.error('❌ خطأ في العميل:', error.message);
        if (!isReady) {
            io.emit('status', { connected: false, message: 'خطأ في الاتصال - جاري إعادة المحاولة...' });
        }
    });

    client.on('disconnected', (reason) => {
        console.log('🔌 WhatsApp disconnected', reason);
        isReady = false;
        qrCode = null;
        allGroups = [];
        
        // إيقاف التحديث التلقائي
        stopAutoRefreshGroups();
        
        // إرسال حالة الانقطاع لجميع المستخدمين
        io.emit('status', { 
            connected: false, 
            message: 'انقطع الاتصال - جاري إعادة الاتصال...',
            authenticating: false
        });
        // إخفاء QR Code القديم
        io.emit('qr_hide');
        
        // تنظيف العميل القديم
        if (client) {
            try {
                client.destroy();
            } catch (e) {
                console.log('⚠️ خطأ في تنظيف العميل:', e.message);
            }
            client = null;
        }
        
        // إعادة التهيئة بعد 3 ثواني (زيادة الوقت قليلاً)
        setTimeout(() => {
            console.log('🔄 إعادة محاولة الاتصال...');
            initializeWhatsApp();
        }, 3000);
    });

    client.on('authenticated', () => {
        console.log('✅ تم المصادقة بنجاح');
    });

    client.on('loading_screen', (percent, message) => {
        console.log(`⏳ جاري التحميل: ${percent}% - ${message}`);
        io.emit('status', { connected: false, message: `جاري التحميل: ${percent}%` });
    });

    // تهيئة العميل مع معالجة الأخطاء
    client.initialize().catch((error) => {
        console.error('❌ خطأ في تهيئة العميل:', error.message);
        io.emit('status', { connected: false, message: 'خطأ في التهيئة - جاري إعادة المحاولة...' });
        
        // إعادة المحاولة بعد 5 ثواني
        setTimeout(() => {
            console.log('🔄 إعادة محاولة التهيئة...');
            initializeWhatsApp();
        }, 5000);
    });
}

// دالة جلب الجروبات
async function loadGroups() {
    if (!client || !isReady) return;
    
    try {
        console.log('🔄 جاري جلب الجروبات...');
        const chats = await client.getChats();
        
        allGroups = chats
            .filter(chat => chat.isGroup)
            .map(group => ({
                id: group.id._serialized,
                name: group.name,
                participants: group.participants.length,
                timestamp: group.timestamp
            }))
            .sort((a, b) => b.timestamp - a.timestamp); // أحدث الجروبات أولاً
        
        console.log(`✅ تم جلب ${allGroups.length} جروب`);
        
        // إرسال التحديث لجميع العملاء المتصلين
        io.emit('groups_loaded', allGroups);
        io.emit('status', { 
            connected: true, 
            message: 'متصل بـ WhatsApp',
            groupsCount: allGroups.length
        });
        
        return allGroups;
    } catch (error) {
        console.error('Error loading groups:', error);
        return [];
    }
}

// تحديث تلقائي للجروبات كل 5 دقائق
let autoRefreshInterval = null;

function startAutoRefreshGroups() {
    // إيقاف أي تحديث سابق
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
    }
    
    // تحديث كل 5 دقائق (300000 مللي ثانية)
    autoRefreshInterval = setInterval(async () => {
        if (isReady && client) {
            console.log('🔄 تحديث تلقائي للجروبات...');
            await loadGroups();
        }
    }, 300000); // 5 دقائق
}

function stopAutoRefreshGroups() {
    if (autoRefreshInterval) {
        clearInterval(autoRefreshInterval);
        autoRefreshInterval = null;
    }
}

// Routes
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Health check endpoint for Railway
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'ok', 
        whatsapp: isReady ? 'connected' : 'disconnected',
        timestamp: new Date().toISOString()
    });
});

// جلب الجروبات
app.get('/api/groups', async (req, res) => {
    if (!isReady) {
        return res.status(400).json({ error: 'الواتساب غير متصل' });
    }
    
    try {
        const groups = await loadGroups();
        res.json(groups);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// إرسال البث
app.post('/api/broadcast', async (req, res) => {
    if (!isReady) {
        return res.json({ success: false, error: 'الواتساب غير متصل' });
    }
    
    const { message, groups } = req.body;
    
    if (!message || !groups || groups.length === 0) {
        return res.json({ success: false, error: 'بيانات غير مكتملة' });
    }
    
    try {
        const results = {
            sent: 0,
            failed: 0,
            details: []
        };
        
        // إرسال لكل الجروبات المحددة
        for (const groupId of groups) {
            try {
                await client.sendMessage(groupId, message);
                results.sent++;
                results.details.push({ groupId, status: 'success' });
                console.log(`✅ تم الإرسال للجروب: ${groupId}`);
                
                // تأخير 2 ثانية بين كل رسالة لتجنب الحظر
                await new Promise(resolve => setTimeout(resolve, 2000));
                
            } catch (error) {
                results.failed++;
                results.details.push({ groupId, status: 'failed', error: error.message });
                console.log(`❌ فشل الإرسال للجروب: ${groupId}`, error);
            }
        }
        
        res.json({
            success: true,
            ...results,
            total: groups.length
        });
        
    } catch (error) {
        res.json({ success: false, error: error.message });
    }
});

// Socket.io للاتصال المباشر
io.on('connection', (socket) => {
    console.log('👤 مستخدم متصل');
    
    // إرسال الحالة الحالية للمستخدم الجديد
    if (isReady) {
        socket.emit('status', { 
            connected: true, 
            message: 'متصل بـ WhatsApp',
            groupsCount: allGroups.length
        });
        socket.emit('groups_loaded', allGroups);
    } else {
        // إذا لم يكن متصل، أرسل QR Code حتى لو لم يكن موجوداً حالياً
        // سيتم إرساله تلقائياً عند إنشائه
        if (qrCode) {
            socket.emit('qr', qrCode);
            socket.emit('status', { connected: false, message: 'امسح QR code' });
        } else {
            socket.emit('status', { connected: false, message: 'جاري التحميل...' });
        }
    }
    
    // استمع لطلب تحديث الجروبات
    socket.on('get_groups', async () => {
        if (isReady) {
            console.log('🔄 طلب تحديث الجروبات من المستخدم');
            await loadGroups();
            socket.emit('groups_loaded', allGroups);
            socket.emit('status', { 
                connected: true, 
                message: 'متصل بـ WhatsApp',
                groupsCount: allGroups.length
            });
        } else {
            socket.emit('status', { connected: false, message: 'الواتساب غير متصل' });
        }
    });
    
    socket.on('disconnect', () => {
        console.log('👤 مستخدم غير متصل');
    });
});

// تشغيل السيرفر
server.listen(PORT, '0.0.0.0', () => {
    console.log(`🌐 السيرفر شغال على البورت ${PORT}`);
    console.log(`🌐 Railway URL: ${process.env.RAILWAY_PUBLIC_DOMAIN || 'Not set'}`);
    initializeWhatsApp();
});