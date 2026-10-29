import React, { useState, useEffect, useMemo, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, collection, onSnapshot, addDoc, deleteDoc, doc, query } from 'firebase/firestore';
import { Calendar, ChevronLeft, ChevronRight, Plus, Trash2, Clock, Monitor, Wrench, Microscope, Printer } from 'lucide-react';

// --- Firebase Initialization ---
// Following specific rules for the collaborative environment
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {
    // Fallback dummy config for local testing if needed
    apiKey: "dummy", authDomain: "dummy", projectId: "dummy", storageBucket: "dummy", messagingSenderId: "dummy", appId: "dummy"
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-rental-app';

// --- Constants & Config ---
const EQUIPMENT_TYPES = [
    { id: 'oscope', name: '示波器', color: 'bg-blue-100 border-blue-400 text-blue-800', icon: <Monitor size={16} /> },
    { id: 'micro', name: '顯微鏡', color: 'bg-green-100 border-green-400 text-green-800', icon: <Microscope size={16} /> },
    { id: 'spec', name: '頻譜分析儀', color: 'bg-purple-100 border-purple-400 text-purple-800', icon: <Wrench size={16} /> },
    { id: '3dprint', name: '3D列印機', color: 'bg-orange-100 border-orange-400 text-orange-800', icon: <Printer size={16} /> },
];

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const HOUR_HEIGHT = 60; // Pixels per hour in the grid

// --- Helper Functions ---
const getStartOfWeek = (date) => {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is sunday
    return new Date(d.setDate(diff));
};

const formatDateForInput = (date) => {
    const tzoffset = (new Date()).getTimezoneOffset() * 60000;
    const localISOTime = (new Date(date - tzoffset)).toISOString().slice(0, 16);
    return localISOTime;
};

// --- Main Application Component ---
export default function App() {
    const [user, setUser] = useState(null);
    const [authLoading, setAuthLoading] = useState(true);
    const [bookings, setBookings] = useState([]);
    
    // Calendar State
    const [currentDate, setCurrentDate] = useState(new Date());
    const [view, setView] = useState('week'); // 'week' or 'day'
    
    // Modal State
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [formData, setFormData] = useState({
        equipmentId: EQUIPMENT_TYPES[0].id,
        userName: '',
        startTime: formatDateForInput(new Date()),
        endTime: formatDateForInput(new Date(new Date().getTime() + 60 * 60 * 1000)), // +1 hour
    });
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [errorMsg, setErrorMsg] = useState('');

    const calendarRef = useRef(null);

    // --- Firebase Auth Effect ---
    useEffect(() => {
        const initAuth = async () => {
            try {
                if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
                    await signInWithCustomToken(auth, __initial_auth_token);
                } else {
                    await signInAnonymously(auth);
                }
            } catch (error) {
                console.error("Auth error:", error);
                setErrorMsg("驗證失敗，無法連接資料庫。");
            }
        };
        initAuth();

        const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
            setUser(currentUser);
            setAuthLoading(false);
        });

        return () => unsubscribe();
    }, []);

    // --- Firestore Data Fetching Effect ---
    useEffect(() => {
        if (!user) return;

        // Rule 1 & 2: Use specific path, fetch all, no complex queries
        const bookingsRef = collection(db, 'artifacts', appId, 'public', 'data', 'equipmentBookings');
        const q = query(bookingsRef);

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const fetchedBookings = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));
            setBookings(fetchedBookings);
        }, (error) => {
            console.error("Firestore error:", error);
            setErrorMsg("讀取資料失敗，請稍後再試。");
        });

        return () => unsubscribe();
    }, [user]);

    // --- Scroll to current time on load ---
    useEffect(() => {
        if (calendarRef.current) {
            const currentHour = new Date().getHours();
            // Scroll to slightly before the current hour
            calendarRef.current.scrollTop = Math.max(0, (currentHour - 2) * HOUR_HEIGHT);
        }
    }, [view, currentDate]);

    // --- Handlers ---
    const handlePrev = () => {
        const newDate = new Date(currentDate);
        if (view === 'week') newDate.setDate(newDate.getDate() - 7);
        else newDate.setDate(newDate.getDate() - 1);
        setCurrentDate(newDate);
    };

    const handleNext = () => {
        const newDate = new Date(currentDate);
        if (view === 'week') newDate.setDate(newDate.getDate() + 7);
        else newDate.setDate(newDate.getDate() + 1);
        setCurrentDate(newDate);
    };

    const handleToday = () => {
        setCurrentDate(new Date());
    };

    const handleOpenModal = (defaultStartTime = null) => {
        const start = defaultStartTime || new Date();
        const end = new Date(start.getTime() + 60 * 60 * 1000);
        setFormData({
            ...formData,
            userName: '', // Keep previous user name might be nice, but reset for now
            startTime: formatDateForInput(start),
            endTime: formatDateForInput(end),
        });
        setErrorMsg('');
        setIsModalOpen(true);
    };

    const handleSubmitBooking = async (e) => {
        e.preventDefault();
        if (!user) return;
        
        if (new Date(formData.startTime) >= new Date(formData.endTime)) {
            setErrorMsg("結束時間必須晚於開始時間！");
            return;
        }
        if (!formData.userName.trim()) {
            setErrorMsg("請輸入使用者姓名！");
            return;
        }

        setIsSubmitting(true);
        setErrorMsg('');

        try {
            const equipment = EQUIPMENT_TYPES.find(eq => eq.id === formData.equipmentId);
            const bookingsRef = collection(db, 'artifacts', appId, 'public', 'data', 'equipmentBookings');
            await addDoc(bookingsRef, {
                equipmentId: formData.equipmentId,
                equipmentName: equipment.name,
                colorClass: equipment.color,
                userName: formData.userName,
                startTime: new Date(formData.startTime).toISOString(),
                endTime: new Date(formData.endTime).toISOString(),
                createdAt: new Date().toISOString(),
                createdBy: user.uid
            });
            setIsModalOpen(false);
        } catch (error) {
            console.error("Error adding booking:", error);
            setErrorMsg("新增預約失敗！");
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDeleteBooking = async (id) => {
        if (!user) return;
        // In a real app, you might use a custom modal instead of confirm, 
        // but since we shouldn't use window.confirm, we'll just delete directly or use a tiny inline confirmation.
        // For simplicity and per rules, we will implement a direct delete for this demo tool.
        try {
            const docRef = doc(db, 'artifacts', appId, 'public', 'data', 'equipmentBookings', id);
            await deleteDoc(docRef);
        } catch (error) {
            console.error("Error deleting:", error);
        }
    };

    // --- Derived Data for Calendar ---
    const daysToRender = useMemo(() => {
        if (view === 'day') return [currentDate];
        
        const start = getStartOfWeek(currentDate);
        return Array.from({ length: 7 }, (_, i) => {
            const d = new Date(start);
            d.setDate(start.getDate() + i);
            return d;
        });
    }, [currentDate, view]);

    // --- Render Helpers ---
    const renderEvent = (booking, dayIndex) => {
        const start = new Date(booking.startTime);
        const end = new Date(booking.endTime);
        
        // Calculate top position based on hours and minutes
        const top = (start.getHours() * HOUR_HEIGHT) + (start.getMinutes() / 60 * HOUR_HEIGHT);
        // Calculate height based on duration
        const durationMins = (end.getTime() - start.getTime()) / (1000 * 60);
        const height = (durationMins / 60) * HOUR_HEIGHT;

        return (
            <div 
                key={booking.id}
                className={`absolute left-1 right-1 rounded-md border p-1 text-xs overflow-hidden shadow-sm ${booking.colorClass} group transition-all hover:z-10`}
                style={{ top: `${top}px`, height: `${height}px`, minHeight: '20px' }}
                title={`${booking.equipmentName} - ${booking.userName}\n${start.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} ~ ${end.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}`}
            >
                <div className="font-semibold truncate">{booking.equipmentName}</div>
                <div className="truncate opacity-90">{booking.userName}</div>
                
                {/* Delete Button (visible on hover) */}
                <button 
                    onClick={(e) => { e.stopPropagation(); handleDeleteBooking(booking.id); }}
                    className="absolute top-1 right-1 p-1 bg-white/50 rounded hover:bg-white/80 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="刪除預約"
                >
                    <Trash2 size={12} className="text-red-600" />
                </button>
            </div>
        );
    };

    if (authLoading) {
        return <div className="flex h-screen items-center justify-center bg-gray-50"><div className="animate-pulse text-lg text-blue-600">載入系統中...</div></div>;
    }

    return (
        <div className="flex flex-col h-screen bg-gray-50 font-sans text-gray-800">
            {/* Header */}
            <header className="bg-white border-b border-gray-200 px-6 py-4 flex flex-col sm:flex-row items-center justify-between gap-4 shadow-sm z-10">
                <div className="flex items-center gap-3">
                    <Calendar className="text-blue-600" size={28} />
                    <h1 className="text-2xl font-bold text-gray-900">部門儀器管理系統</h1>
                </div>

                <div className="flex items-center gap-2">
                    <button onClick={handleToday} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50">
                        今天
                    </button>
                    <div className="flex rounded-md shadow-sm">
                        <button onClick={handlePrev} className="p-2 text-gray-600 bg-white border border-gray-300 rounded-l-md hover:bg-gray-50">
                            <ChevronLeft size={20} />
                        </button>
                        <button onClick={handleNext} className="p-2 text-gray-600 bg-white border border-l-0 border-gray-300 rounded-r-md hover:bg-gray-50">
                            <ChevronRight size={20} />
                        </button>
                    </div>
                    
                    <span className="text-lg font-semibold w-48 text-center hidden md:block">
                        {view === 'week' 
                            ? `${daysToRender[0].toLocaleDateString('zh-TW', {month: 'short', day: 'numeric'})} - ${daysToRender[6].toLocaleDateString('zh-TW', {month: 'short', day: 'numeric'})}`
                            : currentDate.toLocaleDateString('zh-TW', { year: 'numeric', month: 'long', day: 'numeric' })
                        }
                    </span>

                    <div className="flex bg-gray-100 p-1 rounded-lg ml-4">
                        <button 
                            onClick={() => setView('day')} 
                            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${view === 'day' ? 'bg-white shadow text-blue-700' : 'text-gray-600 hover:text-gray-900'}`}
                        >
                            日
                        </button>
                        <button 
                            onClick={() => setView('week')} 
                            className={`px-4 py-1.5 text-sm font-medium rounded-md transition-colors ${view === 'week' ? 'bg-white shadow text-blue-700' : 'text-gray-600 hover:text-gray-900'}`}
                        >
                            週
                        </button>
                    </div>

                    <button 
                        onClick={() => handleOpenModal()}
                        className="ml-4 flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors font-medium shadow-sm"
                    >
                        <Plus size={18} />
                        <span className="hidden sm:inline">新增預約</span>
                    </button>
                </div>
            </header>

            {/* Legend */}
            <div className="bg-white px-6 py-2 border-b border-gray-200 flex flex-wrap gap-4 text-sm z-10 shadow-sm">
                <span className="font-semibold text-gray-600 mr-2 flex items-center"><Clock size={16} className="mr-1"/> 儀器圖例：</span>
                {EQUIPMENT_TYPES.map(eq => (
                    <div key={eq.id} className="flex items-center gap-1.5">
                        <div className={`w-3 h-3 rounded-full ${eq.color.split(' ')[0]}`}></div>
                        <span className="text-gray-700">{eq.name}</span>
                    </div>
                ))}
            </div>

            {/* Calendar Main Body */}
            <div className="flex-1 overflow-hidden flex flex-col bg-white">
                {/* Days Header */}
                <div className="flex border-b border-gray-200 bg-gray-50/80">
                    <div className="w-16 flex-shrink-0 border-r border-gray-200"></div> {/* Time column spacer */}
                    <div className="flex-1 flex">
                        {daysToRender.map((day, i) => {
                            const isToday = day.toDateString() === new Date().toDateString();
                            return (
                                <div key={i} className={`flex-1 flex flex-col items-center justify-center py-3 border-r border-gray-200 last:border-r-0 ${isToday ? 'bg-blue-50' : ''}`}>
                                    <span className={`text-sm font-medium ${isToday ? 'text-blue-600' : 'text-gray-500'}`}>
                                        {['週日', '週一', '週二', '週三', '週四', '週五', '週六'][day.getDay()]}
                                    </span>
                                    <span className={`text-2xl font-bold mt-1 ${isToday ? 'text-blue-700' : 'text-gray-900'}`}>
                                        {day.getDate()}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                </div>

                {/* Time Grid (Scrollable) */}
                <div className="flex-1 overflow-y-auto" ref={calendarRef}>
                    <div className="flex relative" style={{ height: `${24 * HOUR_HEIGHT}px` }}>
                        
                        {/* Time Labels */}
                        <div className="w-16 flex-shrink-0 border-r border-gray-200 bg-gray-50/50 sticky left-0 z-10">
                            {HOURS.map(hour => (
                                <div key={hour} className="text-right pr-2 text-xs text-gray-400 font-medium relative" style={{ height: `${HOUR_HEIGHT}px` }}>
                                    <span className="absolute -top-2.5 right-2">{hour.toString().padStart(2, '0')}:00</span>
                                </div>
                            ))}
                        </div>

                        {/* Grid Columns */}
                        <div className="flex-1 flex relative">
                            {/* Horizontal Grid Lines */}
                            <div className="absolute inset-0 pointer-events-none">
                                {HOURS.map(hour => (
                                    <div key={hour} className="w-full border-t border-gray-100" style={{ height: `${HOUR_HEIGHT}px` }}></div>
                                ))}
                            </div>

                            {/* Day Columns containing Events */}
                            {daysToRender.map((day, dayIndex) => {
                                // Filter events for this specific day
                                const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate());
                                const dayEnd = new Date(dayStart);
                                dayEnd.setDate(dayEnd.getDate() + 1);

                                const eventsForDay = bookings.filter(b => {
                                    const bStart = new Date(b.startTime);
                                    const bEnd = new Date(b.endTime);
                                    // Basic overlap check with the current day
                                    return bStart < dayEnd && bEnd > dayStart;
                                });

                                const isToday = day.toDateString() === new Date().toDateString();

                                return (
                                    <div 
                                        key={dayIndex} 
                                        className={`flex-1 relative border-r border-gray-200 last:border-r-0 ${isToday ? 'bg-blue-50/10' : ''}`}
                                        onClick={(e) => {
                                            // Click on empty space to open modal pre-filled with that time
                                            const rect = e.currentTarget.getBoundingClientRect();
                                            const y = e.clientY - rect.top;
                                            const clickedHour = Math.floor(y / HOUR_HEIGHT);
                                            const newDate = new Date(day);
                                            newDate.setHours(clickedHour, 0, 0, 0);
                                            handleOpenModal(newDate);
                                        }}
                                    >
                                        {/* Current Time Indicator Line */}
                                        {isToday && (
                                            <div 
                                                className="absolute left-0 right-0 border-t-2 border-red-500 z-20 pointer-events-none"
                                                style={{ 
                                                    top: `${(new Date().getHours() * HOUR_HEIGHT) + (new Date().getMinutes() / 60 * HOUR_HEIGHT)}px` 
                                                }}
                                            >
                                                <div className="w-2 h-2 rounded-full bg-red-500 absolute -left-1 -top-1"></div>
                                            </div>
                                        )}

                                        {/* Render Events */}
                                        {eventsForDay.map(booking => renderEvent(booking, dayIndex))}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>

            {/* Add Booking Modal */}
            {isModalOpen && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4">
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-md overflow-hidden">
                        <div className="bg-blue-600 px-6 py-4 flex justify-between items-center">
                            <h2 className="text-xl font-bold text-white">新增儀器預約</h2>
                            <button onClick={() => setIsModalOpen(false)} className="text-white hover:bg-blue-700 p-1 rounded">
                                ✕
                            </button>
                        </div>
                        
                        <form onSubmit={handleSubmitBooking} className="p-6 space-y-4">
                            {errorMsg && (
                                <div className="p-3 bg-red-50 text-red-700 rounded-md text-sm border border-red-200">
                                    {errorMsg}
                                </div>
                            )}

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">選擇儀器</label>
                                <div className="grid grid-cols-2 gap-2">
                                    {EQUIPMENT_TYPES.map(eq => (
                                        <div 
                                            key={eq.id}
                                            onClick={() => setFormData({...formData, equipmentId: eq.id})}
                                            className={`cursor-pointer p-3 rounded-lg border-2 flex items-center gap-2 transition-all ${
                                                formData.equipmentId === eq.id 
                                                ? `border-blue-500 bg-blue-50` 
                                                : 'border-gray-200 hover:border-gray-300'
                                            }`}
                                        >
                                            <div className={`p-1.5 rounded-full ${eq.color.split(' ')[0]} ${eq.color.split(' ')[2]}`}>
                                                {eq.icon}
                                            </div>
                                            <span className="font-medium text-gray-800 text-sm">{eq.name}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">使用者姓名 / 分機</label>
                                <input 
                                    type="text" 
                                    value={formData.userName}
                                    onChange={(e) => setFormData({...formData, userName: e.target.value})}
                                    placeholder="例如：王小明 (Ext. 1234)"
                                    className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
                                    required
                                />
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">開始時間</label>
                                    <input 
                                        type="datetime-local" 
                                        value={formData.startTime}
                                        onChange={(e) => setFormData({...formData, startTime: e.target.value})}
                                        className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                                        required
                                    />
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-gray-700 mb-1">結束時間</label>
                                    <input 
                                        type="datetime-local" 
                                        value={formData.endTime}
                                        onChange={(e) => setFormData({...formData, endTime: e.target.value})}
                                        className="w-full p-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none text-sm"
                                        required
                                    />
                                </div>
                            </div>

                            <div className="pt-4 flex gap-3 justify-end">
                                <button 
                                    type="button" 
                                    onClick={() => setIsModalOpen(false)}
                                    className="px-5 py-2.5 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-lg font-medium transition-colors"
                                >
                                    取消
                                </button>
                                <button 
                                    type="submit" 
                                    disabled={isSubmitting}
                                    className="px-5 py-2.5 text-white bg-blue-600 hover:bg-blue-700 rounded-lg font-medium transition-colors shadow-sm disabled:opacity-50 flex items-center gap-2"
                                >
                                    {isSubmitting ? '儲存中...' : '確認預約'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}