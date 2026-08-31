// ==========================================
// KEPLER INSIGHT PICKLEBALL RESERVATION SYSTEM
// ==========================================

(function () {
    'use strict';

    // --- Configuration ---
    const CONFIG = {
        courts: [
            { id: 1, name: 'Court 1', type: 'pickleball', label: 'Pickleball' },
            { id: 2, name: 'Court 2', type: 'pickleball', label: 'Pickleball' },
            { id: 3, name: 'Court 3', type: 'dual', label: 'Pickleball / Badminton', sports: ['pickleball', 'badminton'] },
            { id: 4, name: 'Table 1', type: 'table-tennis', label: 'Table Tennis' },
            { id: 5, name: 'Table 2', type: 'table-tennis', label: 'Table Tennis' }
        ],
        schedule: {
            weekday: { start: 18, end: 24 },
            weekend: { start: 16, end: 24 }
        },
        rates: {
            pickleball: 300,
            badminton: 300,
            peakStart: 18,
            tableTennisPeak: 200,
            tableTennisOffPeak: 120
        },
        adminPassword: 'RelpicKle2026!'
    };

    // --- State ---
    const State = {
        currentPlayer: JSON.parse(localStorage.getItem('pkl_currentPlayer') || 'null'),
        booking: { court: null, date: null, slots: [], sport: null },
        bookingContact: null,
        homeTab: 'book',
        bookingDate: todayStr(),
        weekOffset: 0,
        calendarMonth: new Date().getMonth(),
        calendarYear: new Date().getFullYear(),
        admin: {
            loggedIn: false,
            activeTab: 'bookings',
            scheduleDate: todayStr()
        }
    };

    // --- Helpers ---
    function todayStr() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    function genId() {
        return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    }

    function genConfirmation() {
        const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
        let code = 'PKL-';
        for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
        return code;
    }

    function formatDate(dateStr) {
        const d = new Date(dateStr + 'T00:00:00');
        return d.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
    }

    function formatHour(h) {
        if (h === 0 || h === 24) return '12:00 AM';
        if (h === 12) return '12:00 PM';
        return h > 12 ? `${h - 12}:00 PM` : `${h}:00 AM`;
    }

    function formatCurrency(amount) {
        return '₱' + amount.toLocaleString('en-PH', { minimumFractionDigits: 2 });
    }

    function isWeekend(dateStr) {
        const d = new Date(dateStr + 'T00:00:00');
        return d.getDay() === 0 || d.getDay() === 6;
    }

    function getAvailableHours(dateStr) {
        const sched = isWeekend(dateStr) ? CONFIG.schedule.weekend : CONFIG.schedule.weekday;
        const hours = [];
        for (let h = sched.start; h < sched.end; h++) hours.push(h);
        return hours;
    }

    function getCourtConfig(courtId) {
        return CONFIG.courts.find(function(c) { return c.id === courtId; });
    }

    function getCourtName(courtId) {
        var c = getCourtConfig(courtId);
        return c ? c.name : 'Court ' + courtId;
    }

    function formatSport(sport) {
        if (!sport) return '';
        if (sport === 'table-tennis') return 'Table Tennis';
        return sport.charAt(0).toUpperCase() + sport.slice(1);
    }

    function getRate(hour, courtId, sport) {
        var court = getCourtConfig(courtId);
        var isPeak = hour >= CONFIG.rates.peakStart;
        if (court) {
            if (court.type === 'table-tennis') return isPeak ? CONFIG.rates.tableTennisPeak : CONFIG.rates.tableTennisOffPeak;
            if (sport === 'badminton') return CONFIG.rates.badminton;
        }
        return CONFIG.rates.pickleball;
    }

    function getDiscount(slotCount) {
        return 0;
    }

    function getRateLabel(hour, courtId, sport) {
        var court = getCourtConfig(courtId);
        if (court && court.type === 'table-tennis') {
            return hour < CONFIG.rates.peakStart ? 'Off-Peak' : 'Peak';
        }
        return '';
    }

    function escapeHtml(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function sendBookingEmail(type, reservation, playerName, playerEmail) {
        var courtConfig = getCourtConfig(reservation.courtId);
        var payload = {
            type: type,
            data: {
                confirmationCode: reservation.confirmationCode,
                playerName: playerName,
                playerEmail: playerEmail,
                courtName: courtConfig ? courtConfig.name : 'Court ' + reservation.courtId,
                sport: reservation.sport || 'pickleball',
                date: reservation.date,
                slots: reservation.slots,
                totalAmount: reservation.totalAmount,
                paymentMethod: reservation.paymentMethod
            }
        };
        fetch('/api/send-email', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        }).then(function(resp) {
            if (!resp.ok) console.error('Email API error:', resp.status);
        }).catch(function(err) {
            console.error('Email send failed:', err);
        });
    }

    // --- Data Layer (API-backed with in-memory cache) ---
    const Data = {
        _players: [],
        _reservations: [],
        _overrides: [],
        _ready: false,
        _writing: false,

        async _api(endpoint, method, body) {
            var opts = { method: method || 'GET', headers: { 'Content-Type': 'application/json' } };
            if (body) opts.body = JSON.stringify(body);
            var resp = await fetch('/api/' + endpoint, opts);
            if (!resp.ok) throw new Error('API error: ' + resp.status);
            return resp.json();
        },

        async init() {
            try {
                var results = await Promise.all([
                    this._api('players'),
                    this._api('reservations'),
                    this._api('overrides')
                ]);
                this._players = (results[0] || []).map(function(p) {
                    return { id: p.id, fullName: p.full_name || p.fullName, email: p.email, contactNumber: p.contact_number || p.contactNumber || '', emergencyContact: p.emergency_contact || p.emergencyContact || '', createdAt: p.created_at || p.createdAt };
                });
                this._reservations = (results[1] || []).map(function(r) {
                    if (typeof r.slots === 'string') r.slots = JSON.parse(r.slots);
                    if (!Array.isArray(r.slots)) r.slots = [];
                    return r;
                });
                this._overrides = results[2] || [];
                this._ready = true;
            } catch (e) {
                console.error('Data init failed:', e);
                this._players = [];
                this._reservations = [];
                this._overrides = [];
                this._ready = true;
            }
        },

        async refresh() {
            if (this._writing) return;
            await this.init();
        },

        getPlayers() { return this._players; },
        async addPlayer(p) {
            p.id = genId();
            p.createdAt = new Date().toISOString();
            await this._api('players', 'POST', p);
            this._players.push(p);
            return p;
        },
        getPlayer(id) { return this._players.find(function(p) { return p.id === id; }); },
        getPlayerByEmail(email) {
            var e = email.toLowerCase();
            return this._players.find(function(p) { return p.email.toLowerCase() === e; });
        },
        async updatePlayer(id, data) {
            var idx = this._players.findIndex(function(p) { return p.id === id; });
            if (idx >= 0) {
                Object.assign(this._players[idx], data);
                await this._api('players', 'PUT', { id: id, fullName: data.fullName || this._players[idx].fullName, contactNumber: data.contactNumber || this._players[idx].contactNumber });
            }
        },

        getReservations() { return this._reservations; },
        async addReservation(r) {
            r.id = genId();
            r.confirmationCode = genConfirmation();
            r.createdAt = new Date().toISOString();
            await this._api('reservations', 'POST', r);
            this._reservations.push(r);
            return r;
        },
        getReservationsByPlayer(playerId) {
            return this._reservations.filter(function(r) { return r.playerId === playerId; }).sort(function(a, b) { return (b.createdAt || '').localeCompare(a.createdAt || ''); });
        },
        getReservationsByDate(date) {
            return this._reservations.filter(function(r) { return r.date === date && r.paymentStatus !== 'cancelled'; });
        },
        getReservationsByCourtAndDate(courtId, date) {
            return this._reservations.filter(function(r) { return r.courtId === courtId && r.date === date && r.paymentStatus !== 'cancelled' && r.paymentStatus !== 'rejected'; });
        },
        async cancelReservation(id) {
            var idx = this._reservations.findIndex(function(r) { return r.id === id; });
            if (idx >= 0) {
                this._reservations[idx].paymentStatus = 'cancelled';
                await this._api('reservations', 'PATCH', { id: id, paymentStatus: 'cancelled' });
            }
        },
        isSlotBooked(courtId, date, hour) {
            return this.getReservationsByCourtAndDate(courtId, date)
                .some(function(r) { return r.slots.some(function(s) { return s.hour === hour; }); });
        },

        getOverrides() { return this._overrides; },
        async addOverride(o) {
            o.id = genId();
            await this._api('overrides', 'POST', o);
            this._overrides.push(o);
            return o;
        },
        async removeOverride(id) {
            this._writing = true;
            this._overrides = this._overrides.filter(function(o) { return o.id !== id; });
            await this._api('overrides', 'DELETE', { id: id });
            this._writing = false;
        },
        isSlotBlocked(courtId, date, hour) {
            return this._overrides.find(function(o) { return o.courtId === courtId && o.date === date && o.hour === hour; }) || false;
        },

        isSlotAvailable(courtId, date, hour) {
            return !this.isSlotBooked(courtId, date, hour) && !this.isSlotBlocked(courtId, date, hour);
        },

        getAllReservationsInRange(startDate, endDate) {
            return this._reservations.filter(function(r) {
                return r.date >= startDate && r.date <= endDate && r.paymentStatus !== 'cancelled';
            });
        },

        async updateReservationStatus(id, status) {
            this._writing = true;
            var idx = this._reservations.findIndex(function(r) { return r.id === id; });
            if (idx >= 0) {
                this._reservations[idx].paymentStatus = status;
                await this._api('reservations', 'PATCH', { id: id, paymentStatus: status });
            }
            this._writing = false;
        },

        async updateReservation(id, updates) {
            this._writing = true;
            var idx = this._reservations.findIndex(function(r) { return r.id === id; });
            if (idx >= 0) {
                Object.assign(this._reservations[idx], updates);
                await this._api('reservations', 'PATCH', Object.assign({ id: id }, updates));
            }
            this._writing = false;
        },

        async deleteReservation(id) {
            this._writing = true;
            this._reservations = this._reservations.filter(function(r) { return r.id !== id; });
            await this._api('reservations', 'DELETE', { id: id });
            this._writing = false;
        }
    };

    // --- UI Utilities ---
    const UI = {
        toast(message, type = 'info') {
            const container = document.getElementById('toast-container');
            const toast = document.createElement('div');
            toast.className = `toast ${type}`;
            const icons = { success: '✓', error: '✗', info: 'ℹ', warning: '⚠' };
            toast.innerHTML = `<span style="font-size:18px">${icons[type] || ''}</span> <span>${escapeHtml(message)}</span>`;
            container.appendChild(toast);
            setTimeout(() => {
                toast.style.animation = 'toastOut 0.3s ease forwards';
                setTimeout(() => toast.remove(), 300);
            }, 3500);
        },

        showModal(title, bodyHtml, footerHtml) {
            const overlay = document.getElementById('modal-overlay');
            const content = document.getElementById('modal-content');
            content.innerHTML = `
                <div class="modal-header">
                    <h3>${escapeHtml(title)}</h3>
                    <button class="modal-close" onclick="document.getElementById('modal-overlay').classList.add('hidden')">&times;</button>
                </div>
                <div class="modal-body">${bodyHtml}</div>
                ${footerHtml ? `<div class="modal-footer">${footerHtml}</div>` : ''}
            `;
            overlay.classList.remove('hidden');
            overlay.onclick = (e) => { if (e.target === overlay) overlay.classList.add('hidden'); };
        },

        closeModal() {
            document.getElementById('modal-overlay').classList.add('hidden');
        },

        showProcessing(message) {
            const el = document.createElement('div');
            el.id = 'processing';
            el.className = 'processing-overlay';
            el.innerHTML = `<div class="spinner"></div><p>${escapeHtml(message)}</p>`;
            document.body.appendChild(el);
        },

        hideProcessing() {
            const el = document.getElementById('processing');
            if (el) el.remove();
        }
    };

    // --- Router ---
    function handleRoute() {
        const hash = location.hash.slice(1) || 'home';
        const [page] = hash.split('/');

        document.querySelectorAll('.nav-link').forEach(link => {
            link.classList.toggle('active', link.dataset.page === page);
        });

        const navLinks = document.getElementById('navLinks');
        if (navLinks.classList.contains('open')) navLinks.classList.remove('open');

        const app = document.getElementById('app');
        const renderers = {
            home: renderHome,
            book: renderHome,
            dashboard: renderDashboard,
            checkout: renderCheckout,
            faq: renderFAQ,
            admin: renderAdmin,
            confirmation: renderConfirmation
        };

        const renderer = renderers[page] || renderHome;
        app.innerHTML = '';
        renderer(app);
        window.scrollTo(0, 0);
    }

    // --- HOME / VENUE PAGE ---
    function renderHome(container) {
        var today = new Date();
        var isWknd = today.getDay() === 0 || today.getDay() === 6;
        var schedNow = isWknd ? CONFIG.schedule.weekend : CONFIG.schedule.weekday;
        var tab = State.homeTab || 'book';

        var html = '<div class="hero">' +
            '<h1>Ready to <span>Serve, Smash, or Rally?</span>' +
            '<span class="hero-sub">welcome to <strong>Kepler Insight School</strong>!</span></h1>' +
            '<p>Book your pickleball court, badminton court, or table tennis table online instantly and get ready to play!</p>' +
        '</div>';

        html += '<div class="venue-header" style="margin-top:20px;">' +
            '<div class="venue-stats-row" style="border-top:none;padding-top:0;">' +
                '<div class="venue-stat"><div class="venue-stat-icon">&#127934;</div><div><strong>5</strong><br><small>Facilities</small></div></div>' +
                '<div class="venue-stat"><div class="venue-stat-icon">&#128347;</div><div><small>open</small><br><strong>' + formatHour(schedNow.start) + '-' + formatHour(schedNow.end) + '</strong></div></div>' +
                '<div class="venue-stat"><div class="venue-stat-icon">&#128197;</div><div><small>Today\'s</small><br><strong>Bookings</strong></div></div>' +
            '</div>' +
        '</div>';

        html += '<div class="venue-tabs">' +
            '<button class="venue-tab ' + (tab === 'book' ? 'active' : '') + '" onclick="window.PKL.homeTab(\'book\')">Book</button>' +
            '<button class="venue-tab ' + (tab === 'about' ? 'active' : '') + '" onclick="window.PKL.homeTab(\'about\')">About</button>' +
            '<button class="venue-tab ' + (tab === 'photos' ? 'active' : '') + '" onclick="window.PKL.homeTab(\'photos\')">Photos</button>' +
        '</div>' +
        '<div id="homeTabContent"></div>';

        container.innerHTML = html;

        var content = document.getElementById('homeTabContent');
        if (tab === 'book') renderBookTab(content);
        else if (tab === 'about') renderAboutTab(content);
        else if (tab === 'photos') renderPhotosTab(content);
    }

    function renderBookTab(content) {
        var dateStr = State.bookingDate || todayStr();
        var hours = getAvailableHours(dateStr);
        var booking = State.booking;
        var html = '';

        var dateLabel = dateStr === todayStr() ? 'Today, ' + formatDate(dateStr) : formatDate(dateStr);
        html += '<div class="book-date-nav">';
        html += '<button class="btn btn-outline btn-sm" onclick="window.PKL.bookingDateNav(-1)">Previous</button>';
        html += '<div class="book-date-label">&#128197; ' + dateLabel + '</div>';
        html += '<button class="btn btn-outline btn-sm" onclick="window.PKL.bookingDateNav(1)">Next</button>';
        html += '<button class="btn btn-outline btn-sm" onclick="window.PKL.bookingDateReset()" title="Go to today">Today</button>';
        html += '</div>';

        html += '<p class="book-instruction">Tap a slot to select it, or drag down the column to take several hours in a row.</p>';

        html += '<div class="grid-legend">';
        html += '<span><span class="gl-dot gl-free"></span> Free</span>';
        html += '<span><span class="gl-dot gl-selected"></span> Your Selection</span>';
        html += '<span><span class="gl-dot gl-taken"></span> Taken</span>';
        html += '<span><span class="gl-dot gl-pending"></span> Reserved</span>';
        html += '<span><span class="gl-dot gl-blocked"></span> Reserved by Venue</span>';
        html += '</div>';

        var gridCols = [];
        CONFIG.courts.forEach(function(c) {
            if (c.type === 'dual') {
                gridCols.push({ courtId: c.id, name: c.name, sport: 'dual', label: 'Pickleball / Badminton', rate: '&#8369;300/hr' });
            } else if (c.type === 'table-tennis') {
                gridCols.push({ courtId: c.id, name: c.name, sport: 'table-tennis', label: c.label, rate: '&#8369;120-200/hr' });
            } else if (c.type === 'badminton') {
                gridCols.push({ courtId: c.id, name: c.name, sport: 'badminton', label: c.label, rate: '&#8369;300/hr' });
            } else {
                gridCols.push({ courtId: c.id, name: c.name, sport: 'pickleball', label: c.label, rate: '&#8369;300/hr' });
            }
        });

        html += '<div class="book-grid-wrapper"><table class="book-grid">';
        html += '<thead><tr><th class="bg-time-header">Time</th>';
        gridCols.forEach(function(col) {
            html += '<th class="bg-court-header"><strong>' + col.name + '</strong><small>' + col.label + '</small><small class="bg-rate">' + col.rate + '</small></th>';
        });
        html += '</tr></thead><tbody>';

        if (hours.length === 0) {
            html += '<tr><td colspan="' + (gridCols.length + 1) + '" class="bg-empty">No operating hours for this date</td></tr>';
        }

        var nowHour = new Date().getHours();
        var isToday = dateStr === todayStr();
        hours.forEach(function(h) {
            html += '<tr><td class="bg-time-cell">' + formatHour(h) + '-' + formatHour(h + 1) + '</td>';
            gridCols.forEach(function(col) {
                var isPast = isToday && h < nowHour;
                var booked = Data.isSlotBooked(col.courtId, dateStr, h);
                var blocked = Data.isSlotBlocked(col.courtId, dateStr, h);
                var sportMatch = booking.sport === col.sport || (col.sport === 'dual' && (booking.sport === 'pickleball' || booking.sport === 'badminton'));
                var isSelected = booking.court === col.courtId && sportMatch && booking.date === dateStr && booking.slots.indexOf(h) >= 0;
                var isPending = false;
                if (booked) {
                    var res = Data.getReservationsByCourtAndDate(col.courtId, dateStr).find(function(r) {
                        return r.slots.some(function(s) { return s.hour === h; });
                    });
                    if (res && res.paymentStatus === 'pending') isPending = true;
                }
                var cls = 'bg-cell';
                var cellContent = '';
                var clickable = false;
                if (isPast) {
                    cls += ' bg-past';
                    cellContent = '-';
                } else if (blocked) {
                    cls += ' bg-blocked';
                    cellContent = escapeHtml(blocked.reason || 'Blocked');
                } else if (booked) {
                    cls += isPending ? ' bg-pending' : ' bg-taken';
                    cellContent = isPending ? 'Reserved' : 'Booked';
                } else if (isSelected) {
                    cls += ' bg-selected';
                    cellContent = '&#8369;' + getRate(h, col.courtId, col.sport);
                    clickable = true;
                } else {
                    cls += ' bg-free';
                    cellContent = '&#8369;' + getRate(h, col.courtId, col.sport);
                    clickable = true;
                }
                html += '<td class="' + cls + '"' + (clickable ? ' onclick="window.PKL.gridSelectSlot(' + col.courtId + ',' + h + ',\'' + col.sport + '\')"' : '') + '>' + cellContent + '</td>';
            });
            html += '</tr>';
        });

        html += '</tbody></table></div>';

        if (booking.court && booking.date === dateStr && booking.slots.length > 0) {
            var sortedSlots = booking.slots.slice().sort(function(a, b) { return a - b; });
            var subtotal = 0;
            sortedSlots.forEach(function(h) { subtotal += getRate(h, booking.court, booking.sport); });
            var disc = getDiscount(sortedSlots.length);
            var discAmt = Math.round(subtotal * disc);
            var total = subtotal - discAmt;
            var courtName = getCourtName(booking.court);
            var sportName = booking.sport ? formatSport(booking.sport) : '';

            html += '<div class="book-summary-bar">';
            html += '<div class="book-summary-info">';
            html += '<strong>' + courtName + (sportName ? ' (' + sportName + ')' : '') + '</strong>';
            html += '<span>' + sortedSlots.length + ' hr' + (sortedSlots.length > 1 ? 's' : '') + ' &bull; ' + formatHour(sortedSlots[0]) + ' - ' + formatHour(sortedSlots[sortedSlots.length - 1] + 1) + '</span>';
            html += '</div>';
            html += '<div class="book-summary-action">';
            html += '<span class="book-total">' + formatCurrency(total) + '</span>';
            html += '<button class="btn btn-primary" onclick="window.PKL.proceedToCheckout()">Book Now</button>';
            html += '<button class="btn btn-outline btn-sm" onclick="window.PKL.resetBooking();window.PKL.homeTab(\'book\')">Clear</button>';
            html += '</div></div>';
        }

        content.innerHTML = html;
    }

    function renderAboutTab(content) {
        var html = '<div class="about-layout">' +
            '<div class="about-col">' +
                '<div class="about-card"><h3>&#128176; Rates</h3>' +
                    '<h4 style="font-size:11px;letter-spacing:1px;color:var(--gray-400);margin:0 0 10px;">RATE BY FACILITY</h4>' +
                    '<div class="rate-list">' +
                        '<div class="rate-row"><span>Court 1 <small>Pickleball</small></span><span><strong>&#8369;300</strong>/hr</span></div>' +
                        '<div class="rate-row"><span>Court 2 <small>Pickleball</small></span><span><strong>&#8369;300</strong>/hr</span></div>' +
                        '<div class="rate-row"><span>Court 3 <small>Pickleball / Badminton</small></span><span><strong>&#8369;300</strong>/hr</span></div>' +
                        '<div class="rate-row"><span>Table 1 <small>Table Tennis</small></span><span><strong>&#8369;120-200</strong>/hr</span></div>' +
                        '<div class="rate-row"><span>Table 2 <small>Table Tennis</small></span><span><strong>&#8369;120-200</strong>/hr</span></div>' +
                    '</div>' +
                                    '</div>' +
                '<div class="about-card"><h3>&#128347; Hours of Operation</h3>' +
                    '<div class="hours-list">' +
                        '<div class="hour-row"><span>Monday - Friday</span><span>6:00 PM - 12:00 AM</span></div>' +
                        '<div class="hour-row"><span>Saturday - Sunday</span><span>4:00 PM - 12:00 AM</span></div>' +
                    '</div>' +
                '</div>' +
            '</div>' +
            '<div class="about-col">' +
                '<div class="about-card"><h3>&#128205; Find Us</h3>' +
                    '<div class="map-container"><iframe src="https://www.google.com/maps/embed?pb=!1m18!1m12!1m3!1d3925.0!2d124.023671!3d10.519099!2m3!1f0!2f0!3f0!3m2!1i1024!2i768!4f13.1!3m3!1m2!1s0x0%3A0x0!2zMTDCsDMxJzA4LjgiTiAxMjTCsDAxJzI1LjIiRQ!5e0!3m2!1sen!2sph!4v1" width="100%" height="200" style="border:0;border-radius:8px;" allowfullscreen="" loading="lazy" referrerpolicy="no-referrer-when-downgrade"></iframe></div>' +
                    '<div class="contact-info"><p>&#128205; Kepler Insight School of Science and Arts, Danao City, Cebu</p>' +
                    '<a href="https://maps.app.goo.gl/S8fPwLjrYJn6UCsZA" target="_blank" rel="noopener" class="btn btn-outline btn-sm mt-1">&#128204; Directions</a></div>' +
                '</div>' +
                '<div class="about-card"><h3>&#127970; Facilities</h3>' +
                    '<div class="facilities-tags"><span>&#127934; 3 Courts</span><span>&#127955; 2 Table Tennis</span></div>' +
                '</div>' +
                '<div class="about-card"><h3>&#128222; Contact Us</h3>' +
                    '<p style="font-size:14px; color:var(--gray-600); margin-bottom:12px;">For inquiries, reservations, or assistance:</p>' +
                    '<div style="display:flex; flex-direction:column; gap:8px;">' +
                        '<div style="display:flex; align-items:center; gap:8px;"><span>&#128222;</span><a href="tel:09312032087" style="color:var(--crimson); font-weight:600;">0931 203 2087</a></div>' +
                        '<div style="display:flex; align-items:center; gap:8px;"><span>&#9993;</span><a href="mailto:booking@keplerinsightschool.com" style="color:var(--crimson); font-weight:600;">booking@keplerinsightschool.com</a></div>' +
                        '<div style="display:flex; align-items:center; gap:8px;"><span>&#9993;</span><a href="mailto:docamaongay9@gmail.com" style="color:var(--crimson); font-weight:600;">docamaongay9@gmail.com</a></div>' +
                    '</div>' +
                '</div>' +
            '</div>' +
        '</div>';

        html += '<div class="about-card mt-3"><h3>&#10067; Frequently Asked Questions</h3>' +
            '<div class="faq-list" style="max-width:100%;">' +
                '<div class="faq-item" onclick="this.classList.toggle(\'open\')"><div class="faq-question"><span>How do I book a court or table?</span><span class="faq-toggle">+</span></div><div class="faq-answer"><p>Select your preferred facility from the Book tab, pick a date, choose your time slots, then proceed to checkout. Enter your details, select a payment method, and confirm your booking.</p></div></div>' +
                '<div class="faq-item" onclick="this.classList.toggle(\'open\')"><div class="faq-question"><span>How much does it cost to play?</span><span class="faq-toggle">+</span></div><div class="faq-answer"><p>Pickleball: &#8369;300/hr. Badminton: &#8369;300/hr. Table Tennis: Off-Peak &#8369;120/hr, Peak &#8369;200/hr (peak hours are 6 PM onwards).</p></div></div>' +
                '<div class="faq-item" onclick="this.classList.toggle(\'open\')"><div class="faq-question"><span>What payment methods are accepted?</span><span class="faq-toggle">+</span></div><div class="faq-answer"><p>We accept GCash and Maribank. Send payment to the number provided at checkout, then upload your receipt screenshot for verification.</p></div></div>' +
                '<div class="faq-item" onclick="this.classList.toggle(\'open\')"><div class="faq-question"><span>Can I cancel or reschedule my booking?</span><span class="faq-toggle">+</span></div><div class="faq-answer"><p>Please contact us at 0931 203 2087 or email booking@keplerinsightschool.com. Booking modifications are subject to availability. Payments are non-refundable.</p></div></div>' +
                '<div class="faq-item" onclick="this.classList.toggle(\'open\')"><div class="faq-question"><span>What happens if I arrive late?</span><span class="faq-toggle">+</span></div><div class="faq-answer"><p>Please arrive at least 5 minutes before your booked time slot. Late arrivals will not receive extended playing time.</p></div></div>' +
            '</div>' +
        '</div>';

        html += '<div class="about-card mt-3"><h3>&#9888;&#65039; Court Rules &amp; Guidelines</h3>' +
            '<div class="rules-grid">' +
                '<div class="rule-item"><span class="rule-icon">&#128685;</span><div><strong>No Smoking</strong><p>Smoking and vaping are strictly prohibited in all court areas and facilities.</p></div></div>' +
                '<div class="rule-item"><span class="rule-icon">&#127864;</span><div><strong>No Alcoholic Beverages</strong><p>Alcohol is not allowed on the premises.</p></div></div>' +
                '<div class="rule-item"><span class="rule-icon">&#128095;</span><div><strong>Proper Footwear Required</strong><p>Players must wear non-marking court shoes. No sandals, slippers, or bare feet.</p></div></div>' +
                '<div class="rule-item"><span class="rule-icon">&#9200;</span><div><strong>Be On Time</strong><p>Please arrive 5 minutes before your slot. Late arrivals will not extend your booking.</p></div></div>' +
                '<div class="rule-item"><span class="rule-icon">&#129520;</span><div><strong>Handle Equipment with Care</strong><p>Return all borrowed equipment in good condition. Damages may incur fees.</p></div></div>' +
                '<div class="rule-item"><span class="rule-icon">&#128686;</span><div><strong>Keep the Courts Clean</strong><p>Dispose of trash properly. Leave the court area clean for the next players.</p></div></div>' +
            '</div>' +
        '</div>';

        content.innerHTML = html;
    }

    function renderPhotosTab(content) {
        var photos = [
            { src: 'img/court (2).jpg', caption: 'Court' },
            { src: 'img/court (3).jpg', caption: 'Court' },
            { src: 'img/court (1).jpg', caption: 'Court' },
            { src: 'img/silica sand (1).jpg', caption: 'Court' },
            { src: 'img/silica sand (2).jpg', caption: 'Court' }
        ];
        content.innerHTML = '<h3 style="font-size:20px;font-weight:700;margin-bottom:16px;">Photos</h3>' +
            '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px;margin-bottom:24px;">' +
            photos.map(function(p) {
                return '<div style="border-radius:12px;overflow:hidden;cursor:pointer;" onclick="window.PKL.viewPhoto(this.querySelector(\'img\').src)">' +
                    '<img src="' + p.src + '" alt="' + p.caption + '" loading="lazy" style="width:100%;height:220px;object-fit:cover;display:block;">' +
                    '<div style="padding:8px 12px;background:var(--gray-50);font-size:13px;font-weight:500;color:var(--gray-600);">' + p.caption + '</div>' +
                '</div>';
            }).join('') +
            '</div>' +
            '<div class="about-card mt-3"><h3>&#9888;&#65039; Court Rules &amp; Guidelines</h3>' +
                '<div class="rules-grid">' +
                    '<div class="rule-item"><span class="rule-icon">&#128685;</span><div><strong>No Smoking</strong><p>Smoking and vaping are strictly prohibited in all court areas and facilities.</p></div></div>' +
                    '<div class="rule-item"><span class="rule-icon">&#127864;</span><div><strong>No Alcoholic Beverages</strong><p>Alcohol is not allowed on the premises.</p></div></div>' +
                    '<div class="rule-item"><span class="rule-icon">&#128095;</span><div><strong>Proper Footwear Required</strong><p>Players must wear non-marking court shoes. No sandals, slippers, or bare feet.</p></div></div>' +
                    '<div class="rule-item"><span class="rule-icon">&#9200;</span><div><strong>Be On Time</strong><p>Please arrive 5 minutes before your slot. Late arrivals will not extend your booking.</p></div></div>' +
                    '<div class="rule-item"><span class="rule-icon">&#129520;</span><div><strong>Handle Equipment with Care</strong><p>Return all borrowed equipment in good condition. Damages may incur fees.</p></div></div>' +
                    '<div class="rule-item"><span class="rule-icon">&#128686;</span><div><strong>Keep the Courts Clean</strong><p>Dispose of trash properly. Leave the court area clean for the next players.</p></div></div>' +
                '</div>' +
            '</div>';
    }

    // --- BOOKING PAGE ---
    function renderBooking(container) {
        const booking = State.booking;
        let step = 1;
        if (booking.court) step = 2;
        if (booking.court && booking.date) step = 3;

        container.innerHTML = `
            <div class="page-header">
                <h1>Book a Court</h1>
                <p>Select your court, date, and time slots</p>
                <div class="accent-line"></div>
            </div>

            <div class="booking-steps">
                <div class="step ${step >= 1 ? (step > 1 ? 'completed' : 'active') : ''}">
                    <span class="step-number">1</span> Court
                </div>
                <div class="step-connector"></div>
                <div class="step ${step >= 2 ? (step > 2 ? 'completed' : 'active') : ''}">
                    <span class="step-number">2</span> Date
                </div>
                <div class="step-connector"></div>
                <div class="step ${step >= 3 ? 'active' : ''}">
                    <span class="step-number">3</span> Time
                </div>
            </div>

            <div class="booking-layout">
                <div class="booking-main" id="bookingMain"></div>
                <div class="booking-sidebar" id="bookingSidebar"></div>
            </div>
        `;

        renderBookingMain();
        renderBookingSidebar();
    }

    function renderBookingMain() {
        const main = document.getElementById('bookingMain');
        if (!main) return;
        const booking = State.booking;

        let html = '';

        // Step 1: Facility Selection
        html += `<div class="card mb-3">
            <div class="card-header">Select Facility</div>
            <div class="court-picker">`;
        CONFIG.courts.forEach(c => {
            const isSelected = booking.court === c.id;
            var icon = c.type === 'table-tennis' ? '&#127955;' : '&#127934;';
            html += `
                <div class="court-card ${isSelected ? 'selected' : ''}" onclick="window.PKL.selectCourt(${c.id})">
                    <div class="court-icon">${icon}</div>
                    <div class="court-name">${c.name}</div>
                    <div class="court-type-label">${c.label}</div>
                    <div class="court-status available">Available</div>
                </div>`;
        });
        html += `</div>`;

        if (booking.court) {
            var selCourt = getCourtConfig(booking.court);
            if (selCourt && selCourt.type === 'dual') {
                var curSport = booking.sport || 'pickleball';
                html += `<div class="sport-selector">
                    <label style="font-weight:600; font-size:14px; margin-bottom:8px; display:block;">Select Sport for ${selCourt.name}:</label>
                    <div class="sport-toggle">
                        <button class="btn ${curSport === 'pickleball' ? 'btn-primary' : 'btn-outline'} btn-sm" onclick="window.PKL.selectSport('pickleball')">&#127934; Pickleball</button>
                        <button class="btn ${curSport === 'badminton' ? 'btn-primary' : 'btn-outline'} btn-sm" onclick="window.PKL.selectSport('badminton')">&#127992; Badminton</button>
                    </div>
                </div>`;
            }
        }

        html += `</div>`;

        // Step 2: Calendar
        if (booking.court) {
            html += renderCalendar();
        }

        // Step 3: Time Slots
        if (booking.court && booking.date) {
            html += renderTimeSlots();
        }

        main.innerHTML = html;
    }

    function renderCalendar() {
        const year = State.calendarYear;
        const month = State.calendarMonth;
        const firstDay = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'];
        const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        let html = `<div class="card mb-3">
            <div class="card-header">Select Date</div>
            <div class="calendar">
                <div class="calendar-header">
                    <button class="calendar-nav" onclick="window.PKL.calNav(-1)">&#9664;</button>
                    <h3>${monthNames[month]} ${year}</h3>
                    <button class="calendar-nav" onclick="window.PKL.calNav(1)">&#9654;</button>
                </div>
                <div class="calendar-days">
                    ${dayNames.map(d => `<div>${d}</div>`).join('')}
                </div>
                <div class="calendar-grid">`;

        for (let i = 0; i < firstDay; i++) {
            html += `<div class="calendar-date empty"></div>`;
        }

        for (let d = 1; d <= daysInMonth; d++) {
            const dateObj = new Date(year, month, d);
            const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
            const isPast = dateObj < today;
            const isToday = dateObj.getTime() === today.getTime();
            const isSelected = State.booking.date === dateStr;

            let classes = 'calendar-date';
            if (isPast) classes += ' disabled';
            if (isToday) classes += ' today';
            if (isSelected) classes += ' selected';

            if (isPast) {
                html += `<div class="${classes}">${d}</div>`;
            } else {
                html += `<button class="${classes}" onclick="window.PKL.selectDate('${dateStr}')">${d}</button>`;
            }
        }

        html += `</div></div>`;

        if (State.booking.date) {
            const weekend = isWeekend(State.booking.date);
            const sched = weekend ? CONFIG.schedule.weekend : CONFIG.schedule.weekday;
            var selCourtCfg = getCourtConfig(State.booking.court);
            var rateNote = '';
            if (selCourtCfg && (selCourtCfg.type === 'table-tennis' || State.booking.sport === 'badminton')) {
                rateNote = ' (Flat rate)';
            } else {
                rateNote = weekend ? ' (Off-Peak & Peak rates)' : ' (Peak rate only)';
            }
            html += `<div class="date-info">
                <strong>${formatDate(State.booking.date)}</strong><br>
                Hours: ${formatHour(sched.start)} – ${formatHour(sched.end)}${rateNote}
            </div>`;
        }

        html += `</div>`;
        return html;
    }

    function renderTimeSlots() {
        const { court, date, slots } = State.booking;
        const hours = getAvailableHours(date);

        let html = `<div class="card">
            <div class="card-header">Select Time Slots</div>
            <div class="timeslot-grid">`;

        hours.forEach(h => {
            const booked = Data.isSlotBooked(court, date, h);
            const blocked = Data.isSlotBlocked(court, date, h);
            const selected = slots.includes(h);
            const rate = getRate(h, court, State.booking.sport);
            const label = getRateLabel(h, court, State.booking.sport);

            let cls = 'timeslot';
            let status = '';
            if (blocked) { cls += ' blocked'; status = 'Blocked'; }
            else if (booked) { cls += ' booked'; status = 'Booked'; }
            else if (selected) { cls += ' selected'; status = 'Selected'; }

            const clickable = !booked && !blocked;
            html += `<div class="${cls}" ${clickable ? `onclick="window.PKL.toggleSlot(${h})"` : ''}>
                <div class="slot-time">${formatHour(h)} – ${formatHour(h + 1)}</div>
                <div class="slot-rate"><span class="rate-amount">${formatCurrency(rate)}</span> / ${label}</div>
                ${status ? `<div class="slot-status">${status}</div>` : ''}
            </div>`;
        });

        html += `</div>
            <div class="timeslot-legend">
                <span><div class="legend-dot available"></div> Available</span>
                <span><div class="legend-dot selected-legend"></div> Selected</span>
                <span><div class="legend-dot booked-legend"></div> Booked</span>
                <span><div class="legend-dot blocked-legend"></div> Blocked</span>
            </div>
        </div>`;

        return html;
    }

    function renderBookingSidebar() {
        const sidebar = document.getElementById('bookingSidebar');
        if (!sidebar) return;
        const { court, date, slots } = State.booking;

        let html = `<div class="booking-summary">
            <div class="summary-header"><h3>Booking Summary</h3></div>
            <div class="summary-body">`;

        if (court) {
            var courtCfg = getCourtConfig(court);
            var courtLabel = getCourtName(court);
            if (State.booking.sport) courtLabel += ' (' + formatSport(State.booking.sport) + ')';
            html += `<div class="summary-row"><span class="label">Facility</span><span class="value">${courtLabel}</span></div>`;
        }
        if (date) {
            html += `<div class="summary-row"><span class="label">Date</span><span class="value">${formatDate(date)}</span></div>`;
        }
        if (slots.length > 0) {
            const sortedSlots = [...slots].sort((a, b) => a - b);
            html += `<div class="summary-row"><span class="label">Time</span><span class="value">${formatHour(sortedSlots[0])} – ${formatHour(sortedSlots[sortedSlots.length - 1] + 1)}</span></div>`;
            html += `<div class="summary-row"><span class="label">Duration</span><span class="value">${slots.length} hour${slots.length > 1 ? 's' : ''}</span></div>`;

            html += `<div class="price-breakdown">`;
            let subtotal = 0;
            sortedSlots.forEach(h => {
                const rate = getRate(h, court, State.booking.sport);
                subtotal += rate;
                html += `<div class="breakdown-item">
                    <span>${formatHour(h)} – ${formatHour(h + 1)} (${getRateLabel(h, court, State.booking.sport)})</span>
                    <span>${formatCurrency(rate)}</span>
                </div>`;
            });
            const disc = getDiscount(slots.length);
            if (disc > 0) {
                const discAmt = Math.round(subtotal * disc);
                const total = subtotal - discAmt;
                html += `<div class="breakdown-item" style="color:var(--success)">
                    <span>Discount (${Math.round(disc * 100)}% — ${slots.length} hrs)</span>
                    <span>-${formatCurrency(discAmt)}</span>
                </div>`;
                html += `<div class="breakdown-total">
                    <span>Total</span>
                    <span class="total-amount">${formatCurrency(total)}</span>
                </div>`;
            } else {
                html += `<div class="breakdown-total">
                    <span>Total</span>
                    <span class="total-amount">${formatCurrency(subtotal)}</span>
                </div>`;
            }
            html += `</div>`;
        }

        if (!court) {
            html += `<div class="empty-state" style="padding:30px 10px"><div class="empty-icon">&#127934;</div><p>Select a court to begin</p></div>`;
        } else if (!date) {
            html += `<div class="empty-state" style="padding:30px 10px"><div class="empty-icon">&#128197;</div><p>Select a date</p></div>`;
        } else if (slots.length === 0) {
            html += `<div class="empty-state" style="padding:30px 10px"><div class="empty-icon">&#128337;</div><p>Select time slots</p></div>`;
        }

        html += `</div></div>`;

        if (slots.length > 0) {
            html += `<button class="btn btn-primary btn-block btn-lg mt-2" onclick="window.PKL.proceedToCheckout()">Proceed to Checkout</button>`;
            html += `<button class="btn btn-outline btn-block btn-sm mt-1" onclick="window.PKL.resetBooking()">Reset Selection</button>`;
        }

        sidebar.innerHTML = html;
    }

    // --- CHECKOUT PAGE ---
    function renderCheckout(container) {
        const { court, date, slots } = State.booking;
        if (!court || !date || slots.length === 0) {
            location.hash = '#book';
            return;
        }

        const sortedSlots = [...slots].sort((a, b) => a - b);
        let subtotal = 0;
        sortedSlots.forEach(h => subtotal += getRate(h, court, State.booking.sport));
        const disc = getDiscount(slots.length);
        const discAmt = Math.round(subtotal * disc);
        const total = subtotal - discAmt;
        const courtDisplayName = getCourtName(court);
        const sportLabel = State.booking.sport ? ' (' + formatSport(State.booking.sport) + ')' : '';

        container.innerHTML = `
            <div class="checkout-page">
                <h1 class="checkout-title">Complete Your Booking</h1>
                <p class="checkout-subtitle">Review your booking details and enter your information</p>

                <div class="checkout-layout">
                    <div class="checkout-summary">
                        <div class="co-summary-card">
                            <h3>Booking Summary</h3>
                            <p class="co-venue-name">Kepler Insight School</p>
                            <p class="co-date">${formatDate(date)}</p>
                            <div class="co-slot-row">
                                <div>
                                    <div class="co-time">${formatHour(sortedSlots[0])} &ndash; ${formatHour(sortedSlots[sortedSlots.length - 1] + 1)}</div>
                                    <div class="co-court">${courtDisplayName}${sportLabel}</div>
                                </div>
                                <div class="co-amount">${formatCurrency(subtotal)}</div>
                            </div>
                            ${disc > 0 ? `<div class="co-fee-row"><span>Discount (${Math.round(disc * 100)}% &mdash; ${slots.length} hrs)</span><span style="color:var(--success)">-${formatCurrency(discAmt)}</span></div>` : ''}
                            <div class="co-total-row"><span>Total</span><span class="co-total-amount">${formatCurrency(total)}</span></div>
                        </div>
                    </div>

                    <div class="checkout-form">
                        <div class="co-form-card">
                            <h3>Your Information</h3>
                            <div class="form-group">
                                <label class="required">Full Name</label>
                                <input type="text" class="form-control" id="coName" placeholder="Juan Dela Cruz" value="${State.bookingContact ? escapeHtml(State.bookingContact.name) : ''}">
                            </div>
                            <div class="form-group">
                                <label class="required">Email Address</label>
                                <input type="email" class="form-control" id="coEmail" placeholder="juan@example.com" value="${State.bookingContact ? escapeHtml(State.bookingContact.email) : ''}">
                            </div>
                            <div class="form-group">
                                <label class="required">Phone Number</label>
                                <input type="tel" class="form-control" id="coPhone" placeholder="+63 912 345 6789" value="${State.bookingContact ? escapeHtml(State.bookingContact.phone) : ''}">
                            </div>
                        </div>

                        <div class="co-form-card">
                            <h3>Payment Method</h3>
                            <div class="payment-methods" id="paymentMethods">
                                <div class="payment-method selected" onclick="window.PKL.selectPayment('gcash', this)">
                                    <div class="pm-icon">&#128241;</div>
                                    <div class="pm-name">GCash</div>
                                </div>
                                <div class="payment-method" onclick="window.PKL.selectPayment('maribank', this)">
                                    <div class="pm-icon">&#127974;</div>
                                    <div class="pm-name">Maribank</div>
                                </div>
                            </div>
                            <input type="hidden" id="selectedPayment" value="gcash">

                            <div class="pay-info-box mt-2">
                                <p><strong>Send ${formatCurrency(total)} to:</strong></p>
                                <div class="pay-detail" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
                                    <span class="pay-number" id="payNumber">0931 203 2087</span>
                                    <button class="btn btn-outline btn-sm" onclick="window.PKL.copyText(document.getElementById('payNumber').textContent,'Account number copied!')" style="font-size:11px;padding:3px 10px;">Copy Number</button>
                                </div>
                                <div style="margin-top:4px;">
                                    <span class="pay-name" id="payName">Don Melton C. (GCash)</span>
                                </div>
                                <p class="pay-note">Send payment to the number above, then upload your receipt screenshot below.</p>
                            </div>

                            <div class="form-group mt-2">
                                <label class="required">Upload Payment Receipt</label>
                                <input type="file" class="form-control" id="receiptUpload" accept="image/*" style="padding:8px;">
                                <div id="receiptPreview" style="margin-top:8px;"></div>
                            </div>
                        </div>

                        <div class="checkout-actions">
                            <button class="btn btn-outline btn-lg" onclick="location.hash='#home'">&#8592; Back to Venue</button>
                            <button class="btn btn-primary btn-lg" onclick="window.PKL.processPayment()">Confirm &amp; Pay</button>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    // --- CONFIRMATION PAGE ---
    function renderConfirmation(container) {
        const data = State.lastConfirmation;
        if (!data) {
            location.hash = '#home';
            return;
        }
        const sortedSlots = [...data.slots].sort((a, b) => a.hour - b.hour);
        const playerEmail = data._playerEmail || '';
        const playerName = data._playerName || '';

        const statusBadge = data.paymentStatus === 'paid'
            ? '<span class="badge badge-success">Approved</span>'
            : '<span class="badge badge-warning">Pending Verification</span>';

        container.innerHTML = `
            <div class="confirmation-container">
                <div class="confirmation-icon">${data.paymentStatus === 'paid' ? '&#9989;' : '&#9203;'}</div>
                <h1 style="font-size:26px; margin-bottom:8px;">${data.paymentStatus === 'paid' ? 'Booking Confirmed!' : 'Booking Submitted!'}</h1>
                <p class="text-muted">${data.paymentStatus === 'paid' ? 'Your court reservation has been approved.' : 'Your booking is pending admin verification. You will be notified once approved.'}</p>
                <div class="confirmation-code">${data.confirmationCode}</div>
                ${playerEmail ? `<p style="font-size:13px; color:var(--gray-500); margin-bottom:24px;">Booked under <strong>${escapeHtml(playerEmail)}</strong></p>` : ''}

                <div class="card" style="text-align:left">
                    <div class="card-header">Reservation Details</div>
                    ${playerName ? `<div class="summary-row"><span class="label">Booked By</span><span class="value">${escapeHtml(playerName)}</span></div>` : ''}
                    <div class="summary-row"><span class="label">Facility</span><span class="value">${getCourtName(data.courtId)}${data.sport && data.sport !== 'pickleball' ? ' (' + formatSport(data.sport) + ')' : ''}</span></div>
                    <div class="summary-row"><span class="label">Date</span><span class="value">${formatDate(data.date)}</span></div>
                    <div class="summary-row"><span class="label">Time</span><span class="value">${formatHour(sortedSlots[0].hour)} – ${formatHour(sortedSlots[sortedSlots.length - 1].hour + 1)}</span></div>
                    <div class="summary-row"><span class="label">Duration</span><span class="value">${data.slots.length} hour${data.slots.length > 1 ? 's' : ''}</span></div>
                    <div class="summary-row"><span class="label">Amount</span><span class="value text-crimson fw-bold">${formatCurrency(data.totalAmount)}</span></div>
                    <div class="summary-row"><span class="label">Payment</span><span class="value">${data.paymentMethod.toUpperCase()}</span></div>
                    <div class="summary-row"><span class="label">Status</span><span class="value">${statusBadge}</span></div>
                </div>

                <div style="margin-top:24px; display:flex; gap:12px; justify-content:center; flex-wrap:wrap;">
                    <a href="#book" class="btn btn-primary" onclick="window.PKL.resetBooking()">Book Another Court</a>
                    <a href="#dashboard" class="btn btn-outline">View My Bookings</a>
                </div>
            </div>
        `;
    }

    // --- DASHBOARD PAGE ---
    function renderDashboard(container) {
        if (!State.currentPlayer) {
            container.innerHTML = `
                <div class="page-header">
                    <h1>My Bookings</h1>
                    <p>Log in to view your booking history</p>
                    <div class="accent-line"></div>
                </div>
                <div style="max-width:400px; margin:40px auto;">
                    <div class="card">
                        <div class="card-header">Player Login</div>
                        <div class="form-group">
                            <label>Email Address</label>
                            <input type="email" class="form-control" id="dashLoginEmail" placeholder="Enter your registered email">
                        </div>
                        <button class="btn btn-primary btn-block" onclick="window.PKL.loginPlayer('dashLoginEmail')">Access My Bookings</button>
                        <p class="text-center mt-2" style="font-size:13px;"><a href="#register">Register as new player</a></p>
                    </div>
                </div>
            `;
            return;
        }

        const player = State.currentPlayer;
        const reservations = Data.getReservationsByPlayer(player.id);
        const active = reservations.filter(r => r.date >= todayStr() && r.paymentStatus !== 'cancelled' && r.paymentStatus !== 'rejected');
        const past = reservations.filter(r => r.date < todayStr() || r.paymentStatus === 'cancelled' || r.paymentStatus === 'rejected');

        container.innerHTML = `
            <div class="page-header">
                <h1>My Bookings</h1>
                <p>Welcome back, ${escapeHtml(player.fullName)}</p>
                <div class="accent-line"></div>
            </div>

            <div class="card mb-3">
                <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
                    <div>
                        <h3 style="font-size:18px; margin-bottom:4px;">${escapeHtml(player.fullName)}</h3>
                        <p class="text-muted" style="font-size:13px;">${escapeHtml(player.email)} &bull; ${escapeHtml(player.contactNumber)}</p>
                    </div>
                    <div style="display:flex; gap:8px;">
                        <a href="#book" class="btn btn-primary btn-sm">Book a Court</a>
                        <button class="btn btn-outline btn-sm" onclick="window.PKL.logout()">Logout</button>
                    </div>
                </div>
            </div>

            <div class="stats-row" style="margin-bottom:24px;">
                <div class="stat-card">
                    <div class="stat-value">${active.length}</div>
                    <div class="stat-label">Active Bookings</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${reservations.filter(r => r.paymentStatus === 'paid').length}</div>
                    <div class="stat-label">Total Bookings</div>
                </div>
                <div class="stat-card">
                    <div class="stat-value">${formatCurrency(reservations.filter(r => r.paymentStatus === 'paid').reduce((s, r) => s + r.totalAmount, 0))}</div>
                    <div class="stat-label">Total Spent</div>
                </div>
            </div>

            ${active.length > 0 ? `
                <h3 style="font-size:17px; margin-bottom:12px;">Active Reservations</h3>
                <div class="table-container card mb-3">
                    <table>
                        <thead><tr><th>Code</th><th>Facility</th><th>Date</th><th>Time</th><th>Amount</th><th>Status</th><th></th></tr></thead>
                        <tbody>
                            ${active.map(r => {
            const ss = [...r.slots].sort((a, b) => a.hour - b.hour);
            return `<tr>
                                    <td><code>${r.confirmationCode}</code></td>
                                    <td>${getCourtName(r.courtId)}</td>
                                    <td>${formatDate(r.date)}</td>
                                    <td>${formatHour(ss[0].hour)} - ${formatHour(ss[ss.length - 1].hour + 1)}</td>
                                    <td>${formatCurrency(r.totalAmount)}</td>
                                    <td><span class="badge ${r.paymentStatus === 'paid' ? 'badge-success' : 'badge-warning'}">${r.paymentStatus === 'paid' ? 'Approved' : 'Pending'}</span></td>
                                    <td><button class="btn btn-danger btn-sm" onclick="window.PKL.cancelBooking('${r.id}')">Cancel</button></td>
                                </tr>`;
        }).join('')}
                        </tbody>
                    </table>
                </div>
            ` : ''}

            ${past.length > 0 ? `
                <h3 style="font-size:17px; margin-bottom:12px;">Past / Cancelled</h3>
                <div class="table-container card">
                    <table>
                        <thead><tr><th>Code</th><th>Facility</th><th>Date</th><th>Time</th><th>Amount</th><th>Status</th></tr></thead>
                        <tbody>
                            ${past.map(r => {
            const ss = [...r.slots].sort((a, b) => a.hour - b.hour);
            const badge = r.paymentStatus === 'cancelled' ? 'badge-danger' : 'badge-info';
            const label = r.paymentStatus === 'cancelled' ? 'Cancelled' : 'Completed';
            return `<tr>
                                    <td><code>${r.confirmationCode}</code></td>
                                    <td>${getCourtName(r.courtId)}</td>
                                    <td>${formatDate(r.date)}</td>
                                    <td>${formatHour(ss[0].hour)} - ${formatHour(ss[ss.length - 1].hour + 1)}</td>
                                    <td>${formatCurrency(r.totalAmount)}</td>
                                    <td><span class="badge ${badge}">${label}</span></td>
                                </tr>`;
        }).join('')}
                        </tbody>
                    </table>
                </div>
            ` : ''}

            ${reservations.length === 0 ? `
                <div class="empty-state card">
                    <div class="empty-icon">&#128197;</div>
                    <h3>No Bookings Yet</h3>
                    <p>You haven't made any reservations. <a href="#book">Book your first court</a>!</p>
                </div>
            ` : ''}
        `;
    }

    // --- FAQ PAGE ---
    function renderFAQ(container) {
        const faqs = [
            {
                q: 'How do I book a court or table?',
                a: 'Click "Book a Court" from the navigation menu. Select your preferred facility (pickleball court, badminton court, or table tennis table), pick a date from the calendar, choose your time slots, then proceed to checkout. Enter your name, contact number, and email, select a payment method, and confirm your booking.'
            },
            {
                q: 'What are the operating hours?',
                a: 'Monday to Friday: 6:00 PM - 12:00 AM. Saturday and Sunday: 4:00 PM - 12:00 AM. The courts are closed outside these hours.'
            },
            {
                q: 'How much does it cost to play?',
                a: 'Pickleball: ₱300/hr. Badminton: ₱300/hr. Table Tennis: Off-Peak ₱120/hr, Peak ₱200/hr (peak hours are 6 PM onwards).'
            },
            {
                q: 'Can I book multiple time slots at once?',
                a: 'Yes! You can select multiple consecutive or non-consecutive time slots in a single booking. The total will be calculated based on the rate for each individual slot.'
            },
            {
                q: 'What payment methods are accepted?',
                a: 'We accept GCash, Maribank, and debit cards. Online payments are processed securely at checkout.'
            },
            {
                q: 'Can I cancel or reschedule my booking?',
                a: 'Please contact the school administration directly for cancellations or rescheduling. Booking modifications are subject to availability and may incur fees depending on the notice given.'
            },
            {
                q: 'Is there a dress code?',
                a: 'Players must wear proper athletic attire and non-marking court shoes. Sandals, slippers, and bare feet are not allowed on the courts for safety reasons.'
            },
            {
                q: 'How do I find the facilities?',
                a: 'The sports facilities are located at Kepler Insight School of Science and Arts. You can find directions on the map displayed on our home page, or open it directly in Google Maps.'
            },
            {
                q: 'What happens if I arrive late?',
                a: 'Please arrive at least 5 minutes before your booked time slot. Late arrivals will not receive extended playing time, and your booking will end at the originally scheduled time.'
            },
            {
                q: 'How many players can use one court?',
                a: 'Each court supports up to 4 players for doubles or 2 players for singles. One booking reserves the entire court for your group.'
            }
        ];

        container.innerHTML = `
            <div class="page-header">
                <h1>Frequently Asked Questions</h1>
                <p>Everything you need to know about booking and playing at our courts</p>
                <div class="accent-line"></div>
            </div>

            <div class="faq-list">
                ${faqs.map((item, i) => `
                    <div class="faq-item" onclick="this.classList.toggle('open')">
                        <div class="faq-question">
                            <span>${item.q}</span>
                            <span class="faq-toggle">+</span>
                        </div>
                        <div class="faq-answer">
                            <p>${item.a}</p>
                        </div>
                    </div>
                `).join('')}
            </div>

            <div class="faq-cta">
                <p>Still have questions? Contact the school administration or visit us during operating hours.</p>
                <a href="#book" class="btn btn-primary">Book a Court Now</a>
            </div>
        `;
    }

    // --- ADMIN PAGE ---
    function renderAdmin(container) {
        if (!State.admin.loggedIn) {
            renderAdminLogin(container);
            return;
        }
        renderAdminPanel(container);
    }

    function renderAdminLogin(container) {
        container.innerHTML = `
            <div class="admin-login">
                <div class="card text-center">
                    <img src="img/logo.png" alt="Kepler Insight" class="logo-large">
                    <h2 style="margin-bottom:4px;">Admin Panel</h2>
                    <p class="text-muted mb-3" style="font-size:14px;">Enter your admin credentials</p>
                    <form id="adminLoginForm">
                        <div class="form-group">
                            <input type="password" class="form-control" id="adminPass" placeholder="Enter admin password" style="text-align:center;">
                        </div>
                        <button type="submit" class="btn btn-primary btn-block">Login</button>
                    </form>
                    <p class="text-muted mt-2" style="font-size:12px;">Contact administrator for access</p>
                </div>
            </div>
        `;

        document.getElementById('adminLoginForm').addEventListener('submit', function (e) {
            e.preventDefault();
            const pass = document.getElementById('adminPass').value;
            if (pass === CONFIG.adminPassword) {
                State.admin.loggedIn = true;
                UI.toast('Admin access granted', 'success');
                renderAdmin(container);
            } else {
                UI.toast('Incorrect password', 'error');
            }
        });
    }

    function renderAdminPanel(container) {
        const tab = State.admin.activeTab;
        container.innerHTML = `
            <div class="admin-topbar">
                <div>
                    <h2>Admin Panel</h2>
                    <p class="text-muted" style="font-size:13px;">Kepler Insight Sports Facility Management</p>
                </div>
                <button class="btn btn-outline btn-sm" onclick="window.PKL.adminLogout()">Logout</button>
            </div>

            <div class="tabs">
                <button class="tab ${tab === 'bookings' ? 'active' : ''}" onclick="window.PKL.adminTab('bookings')">Bookings</button>
                <button class="tab ${tab === 'schedule' ? 'active' : ''}" onclick="window.PKL.adminTab('schedule')">Schedule</button>
                <button class="tab ${tab === 'overrides' ? 'active' : ''}" onclick="window.PKL.adminTab('overrides')">Overrides</button>
                <button class="tab ${tab === 'players' ? 'active' : ''}" onclick="window.PKL.adminTab('players')">Players</button>
                <button class="tab ${tab === 'reports' ? 'active' : ''}" onclick="window.PKL.adminTab('reports')">Reports</button>
            </div>

            <div id="adminTabContent"></div>
        `;

        const content = document.getElementById('adminTabContent');
        if (tab === 'bookings') renderAdminBookings(content);
        else if (tab === 'schedule') renderAdminSchedule(content);
        else if (tab === 'overrides') renderAdminOverrides(content);
        else if (tab === 'players') renderAdminPlayers(content);
        else if (tab === 'reports') renderAdminReports(content);
    }

    function renderAdminBookings(content) {
        const allRes = Data.getReservations();
        const pending = allRes.filter(r => r.paymentStatus === 'pending');
        const approved = allRes.filter(r => r.paymentStatus === 'paid');
        const rejected = allRes.filter(r => r.paymentStatus === 'rejected');

        function statusBadge(s) {
            if (s === 'paid') return '<span class="badge badge-success">Approved</span>';
            if (s === 'pending') return '<span class="badge badge-warning">Pending</span>';
            if (s === 'rejected') return '<span class="badge badge-danger">Rejected</span>';
            if (s === 'cancelled') return '<span class="badge badge-danger">Cancelled</span>';
            return '<span class="badge badge-info">' + s + '</span>';
        }

        function bookingRow(r, showActions) {
            const player = Data.getPlayer(r.playerId);
            const ss = [...r.slots].sort((a, b) => a.hour - b.hour);
            return '<tr>' +
                '<td><code>' + r.confirmationCode + '</code></td>' +
                '<td>' + (player ? escapeHtml(player.fullName) : 'Unknown') + '</td>' +
                '<td>' + getCourtName(r.courtId) + '</td>' +
                '<td>' + formatDate(r.date) + '</td>' +
                '<td>' + formatHour(ss[0].hour) + ' - ' + formatHour(ss[ss.length - 1].hour + 1) + '</td>' +
                '<td>' + formatCurrency(r.totalAmount) + '</td>' +
                '<td>' + r.paymentMethod.toUpperCase() + '</td>' +
                '<td>' + statusBadge(r.paymentStatus) + '</td>' +
                '<td>' + (showActions
                    ? '<button class="btn btn-success btn-sm" onclick="window.PKL.approveBooking(\'' + r.id + '\')">Approve</button> '
                      + '<button class="btn btn-danger btn-sm" onclick="window.PKL.rejectBooking(\'' + r.id + '\')" style="margin-left:4px;">Reject</button> '
                      + '<button class="btn btn-outline btn-sm" onclick="window.PKL.viewReceipt(\'' + r.id + '\')" style="margin-left:4px;">Receipt</button>'
                    : '<button class="btn btn-outline btn-sm" onclick="window.PKL.viewReceipt(\'' + r.id + '\')">View</button>'
                ) + ' <button class="btn btn-outline btn-sm" onclick="window.PKL.deleteBooking(\'' + r.id + '\')" style="margin-left:4px;color:var(--gray-400);">Delete</button></td>' +
            '</tr>';
        }

        content.innerHTML = `
            <div class="card mb-3">
                <div class="card-header" style="display:flex; justify-content:space-between; align-items:center;">
                    <span>&#9203; Pending Verification (${pending.length})</span>
                </div>
                ${pending.length > 0 ? `
                    <div class="table-container">
                        <table>
                            <thead><tr><th>Code</th><th>Player</th><th>Facility</th><th>Date</th><th>Time</th><th>Amount</th><th>Via</th><th>Status</th><th>Actions</th></tr></thead>
                            <tbody>${pending.map(r => bookingRow(r, true)).join('')}</tbody>
                        </table>
                    </div>
                ` : '<p class="text-muted text-center" style="padding:24px; font-size:14px;">No pending bookings</p>'}
            </div>

            <div class="card">
                <div class="card-header">All Bookings (${allRes.length})</div>
                ${allRes.length > 0 ? `
                    <div class="table-container">
                        <table>
                            <thead><tr><th>Code</th><th>Player</th><th>Facility</th><th>Date</th><th>Time</th><th>Amount</th><th>Via</th><th>Status</th><th></th></tr></thead>
                            <tbody>${allRes.sort((a, b) => b.createdAt - a.createdAt).map(r => bookingRow(r, r.paymentStatus === 'pending')).join('')}</tbody>
                        </table>
                    </div>
                ` : '<p class="text-muted text-center" style="padding:24px;">No bookings yet</p>'}
            </div>
        `;
    }

    function renderAdminSchedule(content) {
        const date = State.admin.scheduleDate;
        const hours = getAvailableHours(date);

        let html = `
            <div class="card mb-3">
                <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
                    <h3 style="font-size:16px;">${formatDate(date)}</h3>
                    <input type="date" class="form-control" style="width:auto;" value="${date}" onchange="window.PKL.adminSetDate(this.value)">
                </div>
            </div>

            <div class="card">
                <div class="schedule-grid">
                    <div class="schedule-header">Time</div>
                    ${CONFIG.courts.map(c => `<div class="schedule-header">${c.name}</div>`).join('')}
                    ${hours.map(h => {
            let row = `<div class="schedule-time">${formatHour(h)}</div>`;
            CONFIG.courts.forEach(c => {
                const booked = Data.isSlotBooked(c.id, date, h);
                const blocked = Data.isSlotBlocked(c.id, date, h);
                if (blocked) {
                    row += `<div class="schedule-cell blocked">Blocked</div>`;
                } else if (booked) {
                    const res = Data.getReservationsByCourtAndDate(c.id, date).find(r => r.slots.some(s => s.hour === h));
                    const player = res ? Data.getPlayer(res.playerId) : null;
                    const name = player ? player.fullName : 'Unknown';
                    row += `<div class="schedule-cell booked" onclick="window.PKL.adminViewBooking('${res ? res.id : ''}')">${escapeHtml(name)}</div>`;
                } else {
                    row += `<div class="schedule-cell available">Available</div>`;
                }
            });
            return row;
        }).join('')}
                </div>
            </div>
        `;

        if (hours.length === 0) {
            html += `<div class="empty-state card mt-2"><div class="empty-icon">&#128197;</div><h3>No Operating Hours</h3><p>This day has no scheduled operating hours.</p></div>`;
        }

        content.innerHTML = html;
    }

    function renderAdminOverrides(content) {
        const overrides = Data.getOverrides();

        content.innerHTML = `
            <div class="card mb-3">
                <div class="card-header">Block Time Slots</div>
                <p style="font-size:13px; color:var(--gray-500); margin-bottom:16px;">Block slots for maintenance, school events, or other reasons. Select multiple courts, dates, and hours at once.</p>
                <div class="form-row">
                    <div class="form-group">
                        <label class="required">Courts</label>
                        <div id="overrideCourts" style="display:flex; flex-direction:column; gap:6px;">
                            ${CONFIG.courts.map(c => `<label style="display:flex; align-items:center; gap:6px; font-weight:400; cursor:pointer;"><input type="checkbox" value="${c.id}" style="width:16px; height:16px;"> ${c.name}</label>`).join('')}
                        </div>
                    </div>
                    <div class="form-group">
                        <label class="required">Date Range</label>
                        <div style="display:flex; gap:8px; align-items:center;">
                            <input type="date" class="form-control" id="overrideDateStart" value="${todayStr()}" style="flex:1;">
                            <span style="color:var(--gray-500);">to</span>
                            <input type="date" class="form-control" id="overrideDateEnd" value="${todayStr()}" style="flex:1;">
                        </div>
                        <p style="font-size:11px; color:var(--gray-400); margin-top:4px;">Set both to the same date for a single day.</p>
                    </div>
                </div>
                <div class="form-row">
                    <div class="form-group">
                        <label class="required">Hours</label>
                        <div id="overrideHours" style="display:flex; flex-wrap:wrap; gap:6px;">
                            ${Array.from({ length: 8 }, (_, i) => i + 16).map(h => `<label style="display:flex; align-items:center; gap:4px; font-weight:400; cursor:pointer; min-width:140px;"><input type="checkbox" value="${h}" style="width:16px; height:16px;"> ${formatHour(h)} – ${formatHour(h + 1)}</label>`).join('')}
                        </div>
                        <div style="margin-top:6px;"><button type="button" class="btn btn-outline btn-sm" onclick="document.querySelectorAll('#overrideHours input').forEach(function(c){c.checked=true})">Select All</button> <button type="button" class="btn btn-outline btn-sm" onclick="document.querySelectorAll('#overrideHours input').forEach(function(c){c.checked=false})">Clear</button></div>
                    </div>
                    <div class="form-group">
                        <label class="required">Reason</label>
                        <input type="text" class="form-control" id="overrideReason" placeholder="e.g. Maintenance">
                    </div>
                </div>
                <button class="btn btn-danger" onclick="window.PKL.addOverride()">Block Slots</button>
            </div>

            <div class="card">
                <div class="card-header" style="display:flex; justify-content:space-between; align-items:center;">
                    <span>Current Overrides</span>
                    ${overrides.length > 0 ? '<button class="btn btn-danger btn-sm" onclick="window.PKL.deleteSelectedOverrides()">Delete Selected</button>' : ''}
                </div>
                ${overrides.length > 0 ? `
                    <div class="table-container">
                        <table>
                            <thead><tr><th style="width:40px;"><input type="checkbox" id="overrideSelectAll" onclick="document.querySelectorAll('.override-check').forEach(function(c){c.checked=this.checked}.bind(this))" style="width:16px;height:16px;"></th><th>Court</th><th>Date</th><th>Time</th><th>Reason</th><th></th></tr></thead>
                            <tbody>
                                ${overrides.map(o => `<tr>
                                    <td><input type="checkbox" class="override-check" value="${o.id}" style="width:16px;height:16px;"></td>
                                    <td>${getCourtName(o.courtId)}</td>
                                    <td>${formatDate(o.date)}</td>
                                    <td>${formatHour(o.hour)} – ${formatHour(o.hour + 1)}</td>
                                    <td>${escapeHtml(o.reason)}</td>
                                    <td><button class="btn btn-outline btn-sm" onclick="window.PKL.editOverride('${o.id}')" style="margin-right:4px;">Edit</button><button class="btn btn-outline btn-sm" onclick="window.PKL.removeOverride('${o.id}')">Remove</button></td>
                                </tr>`).join('')}
                            </tbody>
                        </table>
                    </div>
                ` : '<div class="empty-state"><div class="empty-icon">&#9989;</div><p>No active overrides</p></div>'}
            </div>
        `;
    }

    function renderAdminPlayers(content) {
        const players = Data.getPlayers();

        content.innerHTML = `
            <div class="card">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px; flex-wrap:wrap; gap:12px;">
                    <div class="card-header" style="margin-bottom:0; padding-bottom:0; border:none;">Player Registry (${players.length})</div>
                    <input type="text" class="form-control" style="width:250px;" placeholder="Search players..." oninput="window.PKL.filterPlayers(this.value)">
                </div>
                ${players.length > 0 ? `
                    <div class="table-container">
                        <table id="playersTable">
                            <thead><tr><th>Name</th><th>Email</th><th>Contact</th><th>Emergency Contact</th><th>Bookings</th><th>Registered</th></tr></thead>
                            <tbody>
                                ${players.map(p => {
            const bookingCount = Data.getReservationsByPlayer(p.id).filter(r => r.paymentStatus === 'paid').length;
            return `<tr>
                                        <td><strong>${escapeHtml(p.fullName)}</strong></td>
                                        <td>${escapeHtml(p.email)}</td>
                                        <td>${escapeHtml(p.contactNumber)}</td>
                                        <td>${escapeHtml(p.emergencyContact)}</td>
                                        <td>${bookingCount}</td>
                                        <td>${new Date(p.createdAt).toLocaleDateString()}</td>
                                    </tr>`;
        }).join('')}
                            </tbody>
                        </table>
                    </div>
                ` : '<div class="empty-state"><div class="empty-icon">&#128101;</div><h3>No Players</h3><p>No players have registered yet.</p></div>'}
            </div>
        `;
    }

    function renderAdminReports(content) {
        const allRes = Data.getReservations().filter(r => r.paymentStatus === 'paid' || r.paymentStatus === 'confirmed');
        const today = todayStr();

        const todayRes = allRes.filter(r => r.date === today);
        const todayRevenue = todayRes.reduce((s, r) => s + r.totalAmount, 0);

        const now = new Date();
        const weekStart = new Date(now);
        weekStart.setDate(now.getDate() - now.getDay());
        const weekStartStr = `${weekStart.getFullYear()}-${String(weekStart.getMonth() + 1).padStart(2, '0')}-${String(weekStart.getDate()).padStart(2, '0')}`;
        const weekRes = allRes.filter(r => r.date >= weekStartStr && r.date <= today);
        const weekRevenue = weekRes.reduce((s, r) => s + r.totalAmount, 0);

        const monthStr = today.slice(0, 7);
        const monthRes = allRes.filter(r => r.date.startsWith(monthStr));
        const monthRevenue = monthRes.reduce((s, r) => s + r.totalAmount, 0);

        const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const lastMonthStr = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}`;
        const lastMonthName = lastMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
        const lastMonthRes = allRes.filter(r => r.date.startsWith(lastMonthStr));
        const lastMonthRevenue = lastMonthRes.reduce((s, r) => s + r.totalAmount, 0);

        const totalRevenue = allRes.reduce((s, r) => s + r.totalAmount, 0);
        const avgBooking = allRes.length > 0 ? Math.round(totalRevenue / allRes.length) : 0;
        const totalSlots = allRes.reduce((s, r) => s + (r.slots ? r.slots.length : 0), 0);

        const gcashRes = allRes.filter(r => r.paymentMethod === 'gcash');
        const gcashRevenue = gcashRes.reduce((s, r) => s + r.totalAmount, 0);
        const maribankRes = allRes.filter(r => r.paymentMethod === 'maribank');
        const maribankRevenue = maribankRes.reduce((s, r) => s + r.totalAmount, 0);

        const courtStats = CONFIG.courts.map(c => {
            const cRes = allRes.filter(r => r.courtId === c.id);
            return { name: c.name, bookings: cRes.length, revenue: cRes.reduce((s, r) => s + r.totalAmount, 0) };
        });

        var hourCounts = {};
        allRes.forEach(r => { if (r.slots) r.slots.forEach(s => { hourCounts[s.hour] = (hourCounts[s.hour] || 0) + 1; }); });
        var peakHour = Object.keys(hourCounts).sort((a, b) => hourCounts[b] - hourCounts[a])[0];
        var peakHourLabel = peakHour ? formatHour(Number(peakHour)) + ' - ' + formatHour(Number(peakHour) + 1) : 'N/A';

        var dailyMap = {};
        monthRes.forEach(r => { dailyMap[r.date] = (dailyMap[r.date] || 0) + r.totalAmount; });
        var dailyEntries = Object.keys(dailyMap).sort();

        var monthlyData = [];
        var monthlyMap = {};
        allRes.forEach(r => {
            var m = r.date.slice(0, 7);
            monthlyMap[m] = (monthlyMap[m] || 0) + r.totalAmount;
        });
        var allMonths = Object.keys(monthlyMap).sort();
        if (allMonths.length > 0) {
            var first = new Date(allMonths[0] + '-01');
            var last = new Date(allMonths[allMonths.length - 1] + '-01');
            var cur = new Date(first);
            while (cur <= last) {
                var key = cur.getFullYear() + '-' + String(cur.getMonth() + 1).padStart(2, '0');
                monthlyData.push({ month: key, label: cur.toLocaleDateString('en-US', { month: 'short' }), revenue: monthlyMap[key] || 0 });
                cur.setMonth(cur.getMonth() + 1);
            }
        }
        var maxMonthly = Math.max.apply(null, monthlyData.map(m => m.revenue).concat([1]));

        var weeklyData = [];
        var weeklyMap = {};
        var wkDays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
        weekRes.forEach(r => {
            var dayIdx = new Date(r.date + 'T00:00:00').getDay();
            weeklyMap[dayIdx] = (weeklyMap[dayIdx] || 0) + r.totalAmount;
        });
        for (var di = 0; di < 7; di++) {
            weeklyData.push({ label: wkDays[di], revenue: weeklyMap[di] || 0 });
        }
        var maxWeekly = Math.max.apply(null, weeklyData.map(d => d.revenue).concat([1]));

        content.innerHTML = `
            <div class="report-grid">
                <div class="report-card">
                    <h4>Today's Revenue</h4>
                    <div class="report-value crimson">${formatCurrency(todayRevenue)}</div>
                    <div class="report-sub">${todayRes.length} booking${todayRes.length !== 1 ? 's' : ''}</div>
                </div>
                <div class="report-card">
                    <h4>This Week</h4>
                    <div class="report-value">${formatCurrency(weekRevenue)}</div>
                    <div class="report-sub">${weekRes.length} booking${weekRes.length !== 1 ? 's' : ''}</div>
                </div>
                <div class="report-card">
                    <h4>This Month</h4>
                    <div class="report-value">${formatCurrency(monthRevenue)}</div>
                    <div class="report-sub">${monthRes.length} booking${monthRes.length !== 1 ? 's' : ''}</div>
                </div>
                <div class="report-card">
                    <h4>${lastMonthName}</h4>
                    <div class="report-value">${formatCurrency(lastMonthRevenue)}</div>
                    <div class="report-sub">${lastMonthRes.length} booking${lastMonthRes.length !== 1 ? 's' : ''}</div>
                </div>
            </div>

            <div class="report-grid" style="margin-top:12px;">
                <div class="report-card">
                    <h4>All Time Revenue</h4>
                    <div class="report-value crimson">${formatCurrency(totalRevenue)}</div>
                    <div class="report-sub">${allRes.length} total bookings</div>
                </div>
                <div class="report-card">
                    <h4>Avg. Booking Value</h4>
                    <div class="report-value">${formatCurrency(avgBooking)}</div>
                    <div class="report-sub">${totalSlots} total hours played</div>
                </div>
                <div class="report-card">
                    <h4>Peak Hour</h4>
                    <div class="report-value" style="font-size:22px;">${peakHourLabel}</div>
                    <div class="report-sub">${peakHour ? hourCounts[peakHour] + ' bookings' : ''}</div>
                </div>
                <div class="report-card">
                    <h4>Total Players</h4>
                    <div class="report-value">${Data.getPlayers().length}</div>
                    <div class="report-sub">registered users</div>
                </div>
            </div>

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:20px;">
                <div class="card" style="margin:0;">
                    <div class="card-header">Monthly Revenue</div>
                    <div style="display:flex;align-items:flex-end;gap:4px;height:180px;padding:16px 8px 0;">
                        ${monthlyData.map(m => {
                            var pct = maxMonthly > 0 ? Math.round(m.revenue / maxMonthly * 100) : 0;
                            var isCurrentMonth = m.month === monthStr;
                            return '<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;">' +
                                '<span style="font-size:10px;font-weight:600;color:var(--gray-600);">' + (m.revenue > 0 ? '₱' + (m.revenue / 1000).toFixed(1) + 'k' : '') + '</span>' +
                                '<div style="width:100%;max-width:48px;height:' + Math.max(pct, 4) + '%;background:' + (isCurrentMonth ? 'var(--crimson)' : 'rgba(204,34,41,0.25)') + ';border-radius:6px 6px 0 0;min-height:4px;"></div>' +
                                '<span style="font-size:11px;color:var(--gray-500);font-weight:' + (isCurrentMonth ? '700' : '400') + ';">' + m.label + '</span>' +
                            '</div>';
                        }).join('')}
                    </div>
                </div>
                <div class="card" style="margin:0;">
                    <div class="card-header">This Week</div>
                    <div style="display:flex;align-items:flex-end;gap:4px;height:180px;padding:16px 8px 0;">
                        ${weeklyData.map((d, i) => {
                            var pct = maxWeekly > 0 ? Math.round(d.revenue / maxWeekly * 100) : 0;
                            var isToday = new Date().getDay() === i;
                            return '<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;">' +
                                '<span style="font-size:10px;font-weight:600;color:var(--gray-600);">' + (d.revenue > 0 ? '₱' + (d.revenue >= 1000 ? (d.revenue / 1000).toFixed(1) + 'k' : d.revenue) : '') + '</span>' +
                                '<div style="width:100%;max-width:48px;height:' + Math.max(pct, 4) + '%;background:' + (isToday ? 'var(--crimson)' : 'rgba(204,34,41,0.25)') + ';border-radius:6px 6px 0 0;min-height:4px;"></div>' +
                                '<span style="font-size:11px;color:var(--gray-500);font-weight:' + (isToday ? '700' : '400') + ';">' + d.label + '</span>' +
                            '</div>';
                        }).join('')}
                    </div>
                </div>
            </div>

            <div class="card mb-3" style="margin-top:16px;">
                <div class="card-header">Revenue by Payment Method</div>
                <div class="table-container">
                    <table>
                        <thead><tr><th>Method</th><th>Bookings</th><th>Revenue</th><th>Share</th></tr></thead>
                        <tbody>
                            <tr>
                                <td><strong>GCash</strong></td>
                                <td>${gcashRes.length}</td>
                                <td>${formatCurrency(gcashRevenue)}</td>
                                <td>${totalRevenue > 0 ? Math.round(gcashRevenue / totalRevenue * 100) : 0}%</td>
                            </tr>
                            <tr>
                                <td><strong>MariBank</strong></td>
                                <td>${maribankRes.length}</td>
                                <td>${formatCurrency(maribankRevenue)}</td>
                                <td>${totalRevenue > 0 ? Math.round(maribankRevenue / totalRevenue * 100) : 0}%</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>

            <div class="card mb-3">
                <div class="card-header">Revenue by Facility</div>
                <div class="table-container">
                    <table>
                        <thead><tr><th>Facility</th><th>Bookings</th><th>Revenue</th><th>Share</th></tr></thead>
                        <tbody>
                            ${courtStats.map(c => `<tr>
                                <td><strong>${c.name}</strong></td>
                                <td>${c.bookings}</td>
                                <td>${formatCurrency(c.revenue)}</td>
                                <td>${totalRevenue > 0 ? Math.round(c.revenue / totalRevenue * 100) : 0}%</td>
                            </tr>`).join('')}
                        </tbody>
                    </table>
                </div>
            </div>

            ${dailyEntries.length > 0 ? `
            <div class="card mb-3">
                <div class="card-header">Daily Revenue - ${now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</div>
                <div class="table-container">
                    <table>
                        <thead><tr><th>Date</th><th>Revenue</th></tr></thead>
                        <tbody>
                            ${dailyEntries.map(d => `<tr>
                                <td>${formatDate(d)}</td>
                                <td>${formatCurrency(dailyMap[d])}</td>
                            </tr>`).join('')}
                            <tr style="font-weight:700;border-top:2px solid var(--gray-300);">
                                <td>Total</td>
                                <td>${formatCurrency(monthRevenue)}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
            </div>
            ` : ''}

            <div class="card">
                <div class="card-header">Recent Transactions</div>
                ${allRes.length > 0 ? `
                    <div class="table-container">
                        <table>
                            <thead><tr><th>Code</th><th>Player</th><th>Facility</th><th>Date</th><th>Amount</th><th>Payment</th></tr></thead>
                            <tbody>
                                ${allRes.slice(0, 20).map(r => {
            const player = Data.getPlayer(r.playerId);
            return `<tr>
                                        <td><code>${r.confirmationCode}</code></td>
                                        <td>${player ? escapeHtml(player.fullName) : 'Unknown'}</td>
                                        <td>${getCourtName(r.courtId)}</td>
                                        <td>${formatDate(r.date)}</td>
                                        <td>${formatCurrency(r.totalAmount)}</td>
                                        <td><span class="badge badge-gold">${r.paymentMethod.toUpperCase()}</span></td>
                                    </tr>`;
        }).join('')}
                            </tbody>
                        </table>
                    </div>
                ` : '<div class="empty-state"><div class="empty-icon">&#128200;</div><p>No transactions yet</p></div>'}
            </div>
        `;
    }

    // --- Global Actions (exposed to onclick handlers) ---
    window.PKL = {
        selectCourt(id) {
            State.booking.court = id;
            State.booking.date = null;
            State.booking.slots = [];
            var courtCfg = getCourtConfig(id);
            if (courtCfg && courtCfg.type === 'dual') {
                State.booking.sport = State.booking.sport || 'pickleball';
            } else if (courtCfg && courtCfg.type === 'table-tennis') {
                State.booking.sport = 'table-tennis';
            } else {
                State.booking.sport = 'pickleball';
            }
            renderBookingMain();
            renderBookingSidebar();
        },

        calNav(dir) {
            State.calendarMonth += dir;
            if (State.calendarMonth > 11) { State.calendarMonth = 0; State.calendarYear++; }
            if (State.calendarMonth < 0) { State.calendarMonth = 11; State.calendarYear--; }
            renderBookingMain();
        },

        selectDate(dateStr) {
            State.booking.date = dateStr;
            State.booking.slots = [];
            renderBookingMain();
            renderBookingSidebar();
        },

        toggleSlot(hour) {
            const idx = State.booking.slots.indexOf(hour);
            if (idx >= 0) State.booking.slots.splice(idx, 1);
            else State.booking.slots.push(hour);
            renderBookingMain();
            renderBookingSidebar();
        },

        resetBooking() {
            State.booking = { court: null, date: null, slots: [], sport: null };
        },

        proceedToCheckout() {
            if (!State.currentPlayer) {
                UI.toast('Please register or log in first', 'warning');
            }
            UI.showModal('Facility Risk Management and Liability',
                '<div style="max-height:60vh;overflow-y:auto;font-size:13px;line-height:1.6;color:var(--gray-700);">' +
                    '<h4 style="font-size:14px;font-weight:700;margin-bottom:12px;text-transform:uppercase;letter-spacing:0.5px;">Pickleball Court Rental Liability Waiver and Release of Claims</h4>' +
                    '<p style="margin-bottom:12px;">By completing your booking, submitting payment, or entering the court premises, you agree to the following terms:</p>' +
                    '<p style="margin-bottom:10px;"><strong>1. Facility Rental Only:</strong> You acknowledge that Kepler Insight School (“Management”) is strictly providing access to the court facilities on a venue-rental basis. Management does not provide supervision, instruction, or medical personnel on site.</p>' +
                    '<p style="margin-bottom:10px;"><strong>2. Assumption of Risk:</strong> Playing pickleball involves inherent risks, including but not limited to slip and falls, collisions, muscle strains, eye injuries, fractures, and other personal injuries. You voluntarily assume all risks, hazards, and dangers arising from or related to your use of the court and surrounding facilities.</p>' +
                    '<p style="margin-bottom:10px;"><strong>3. Release &amp; Hold Harmless:</strong> You agree that Kepler Insight School, its owners, staff, and representatives shall not be held liable for any personal injury, illness, loss, or property damage sustained while on the premises, regardless of how it occurs.</p>' +
                    '<p style="margin-bottom:10px;"><strong>4. Player Responsibility:</strong> Players are responsible for ensuring they are physically fit to play, wearing proper footwear, inspecting the court area before play, and bringing their own protective gear (e.g., eye protection).</p>' +
                    '<p style="margin-top:14px;font-style:italic;color:var(--gray-500);">By proceeding with your reservation, you acknowledge that you have read, understood, and voluntarily agreed to this waiver.</p>' +
                '</div>',
                '<button class="btn btn-primary" onclick="window.PKL.closeModal();location.hash=\'#checkout\';">I Agree &amp; Proceed</button>' +
                '<button class="btn btn-outline" onclick="window.PKL.closeModal()">Cancel</button>'
            );
        },

        selectPayment(method, el) {
            document.querySelectorAll('.payment-method').forEach(m => m.classList.remove('selected'));
            el.classList.add('selected');
            document.getElementById('selectedPayment').value = method;
            const payNumber = document.getElementById('payNumber');
            const payName = document.getElementById('payName');
            if (payNumber && payName) {
                if (method === 'gcash') {
                    payNumber.textContent = '0931 203 2087';
                    payName.textContent = 'Don Melton C. (GCash)';
                } else if (method === 'maribank') {
                    payNumber.textContent = '1073 021 0780';
                    payName.textContent = 'Don Melton Camaongay (MariBank)';
                }
            }
        },

        processPayment() {
            const name = document.getElementById('coName').value.trim();
            const phone = document.getElementById('coPhone').value.trim();
            const email = document.getElementById('coEmail').value.trim();

            if (!name || !phone || !email) {
                UI.toast('Please fill in your name, contact number, and email', 'error');
                return;
            }
            if (!/\S+@\S+\.\S+/.test(email)) {
                UI.toast('Please enter a valid email address', 'error');
                return;
            }

            State.bookingContact = { name, phone, email };

            const { court, date, slots } = State.booking;
            if (!court || !date || slots.length === 0) {
                UI.toast('Invalid booking', 'error');
                return;
            }

            if (date === todayStr()) {
                var currentHour = new Date().getHours();
                for (const h of slots) {
                    if (h < currentHour) {
                        UI.toast('One or more selected time slots have already passed', 'error');
                        return;
                    }
                }
            }

            for (const h of slots) {
                if (!Data.isSlotAvailable(court, date, h)) {
                    UI.toast(`Slot ${formatHour(h)} is no longer available`, 'error');
                    return;
                }
            }

            var player = Data.getPlayerByEmail(email);

            const paymentMethod = document.getElementById('selectedPayment').value;
            const receiptInput = document.getElementById('receiptUpload');
            if (!receiptInput || !receiptInput.files || receiptInput.files.length === 0) {
                UI.toast('Please upload your payment receipt', 'error');
                return;
            }
            var receiptFile = receiptInput.files[0];
            if (receiptFile.size > 5 * 1024 * 1024) {
                UI.toast('Receipt image must be under 5MB', 'error');
                return;
            }
            if (!receiptFile.type.startsWith('image/')) {
                UI.toast('Please upload an image file', 'error');
                return;
            }

            const slotData = slots.map(h => ({ hour: h, rate: getRate(h, court, State.booking.sport) }));
            const subtotal = slotData.reduce((s, sl) => s + sl.rate, 0);
            const disc = getDiscount(slots.length);
            const discAmt = Math.round(subtotal * disc);
            const total = subtotal - discAmt;

            UI.showProcessing('Submitting booking...');

            const reader = new FileReader();
            reader.onload = async function(e) {
                try {
                    const receiptData = e.target.result;

                    if (!player) {
                        player = await Data.addPlayer({ fullName: name, contactNumber: phone, email: email, emergencyContact: '' });
                    } else {
                        await Data.updatePlayer(player.id, { fullName: name, contactNumber: phone });
                    }

                    const reservation = await Data.addReservation({
                        playerId: player.id,
                        courtId: court,
                        sport: State.booking.sport || 'pickleball',
                        date: date,
                        slots: slotData,
                        totalAmount: total,
                        paymentStatus: 'pending',
                        paymentMethod: paymentMethod,
                        receiptImage: receiptData
                    });

                    sendBookingEmail('pending', reservation, name, email);

                    State.lastConfirmation = reservation;
                    State.lastConfirmation._playerName = name;
                    State.lastConfirmation._playerEmail = email;
                    State.booking = { court: null, date: null, slots: [], sport: null };
                    UI.hideProcessing();
                    UI.toast('Booking submitted! Awaiting admin verification.', 'success');
                    location.hash = '#confirmation';
                } catch (err) {
                    UI.hideProcessing();
                    UI.toast('Failed to submit booking. Please try again.', 'error');
                    console.error('Booking error:', err);
                }
            };
            reader.readAsDataURL(receiptInput.files[0]);
        },

        loginPlayer(inputId) {
            const id = inputId || 'loginEmail';
            const emailEl = document.getElementById(id);
            if (!emailEl) return;
            const email = emailEl.value.trim();
            if (!email) { UI.toast('Please enter your email', 'error'); return; }

            var reservations = Data.getReservations().filter(function(r) {
                var player = Data.getPlayer(r.playerId);
                return player && player.email.toLowerCase() === email.toLowerCase();
            });

            if (reservations.length === 0) {
                UI.toast('No bookings found for this email', 'error');
                return;
            }

            var player = Data.getPlayerByEmail(email);
            State.currentPlayer = player;
            localStorage.setItem('pkl_currentPlayer', JSON.stringify(player));
            UI.toast('Welcome back, ' + player.fullName, 'success');
            handleRoute();
        },

        logout() {
            State.currentPlayer = null;
            localStorage.removeItem('pkl_currentPlayer');
            UI.toast('Logged out successfully', 'info');
            handleRoute();
        },

        cancelBooking(id) {
            UI.showModal('Cancel Booking', '<p>Are you sure you want to cancel this reservation? This action cannot be undone.</p>',
                `<button class="btn btn-outline" onclick="window.PKL.closeModal()">Keep Booking</button>
                 <button class="btn btn-danger" onclick="window.PKL.confirmCancel('${id}')">Cancel Booking</button>`
            );
        },

        async confirmCancel(id) {
            try {
                await Data.cancelReservation(id);
                UI.closeModal();
                UI.toast('Booking cancelled', 'info');
                handleRoute();
            } catch (err) {
                UI.toast('Failed to cancel booking', 'error');
            }
        },

        closeModal() { UI.closeModal(); },

        copyText(text, msg) {
            navigator.clipboard.writeText(text.replace(/[^\d]/g, '')).then(function() {
                UI.toast(msg || 'Copied!', 'success');
            }).catch(function() {
                UI.toast('Could not copy', 'error');
            });
        },

        // Admin
        adminLogout() {
            State.admin.loggedIn = false;
            handleRoute();
        },

        adminTab(tab) {
            State.admin.activeTab = tab;
            const content = document.getElementById('adminTabContent');
            if (!content) return;
            document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.textContent.toLowerCase() === tab));
            if (tab === 'bookings') renderAdminBookings(content);
            else if (tab === 'schedule') renderAdminSchedule(content);
            else if (tab === 'overrides') renderAdminOverrides(content);
            else if (tab === 'players') renderAdminPlayers(content);
            else if (tab === 'reports') renderAdminReports(content);
        },

        adminSetDate(date) {
            State.admin.scheduleDate = date;
            const content = document.getElementById('adminTabContent');
            if (content) renderAdminSchedule(content);
        },

        async approveBooking(id) {
            try {
                await Data.updateReservationStatus(id, 'paid');
                var res = Data.getReservations().find(function(r) { return r.id === id; });
                if (res) {
                    var player = Data.getPlayer(res.playerId);
                    if (player) {
                        sendBookingEmail('confirmed', res, player.fullName, player.email);
                    }
                }
                UI.toast('Booking approved!', 'success');
                const content = document.getElementById('adminTabContent');
                if (content) renderAdminBookings(content);
            } catch (err) {
                UI.toast('Failed to approve booking', 'error');
            }
        },

        async rejectBooking(id) {
            try {
                await Data.updateReservationStatus(id, 'rejected');
                var res = Data.getReservations().find(function(r) { return r.id === id; });
                if (res) {
                    var player = Data.getPlayer(res.playerId);
                    if (player) {
                        sendBookingEmail('rejected', res, player.fullName, player.email);
                    }
                }
                UI.toast('Booking rejected', 'info');
                const content = document.getElementById('adminTabContent');
                if (content) renderAdminBookings(content);
            } catch (err) {
                UI.toast('Failed to reject booking', 'error');
            }
        },

        async deleteBooking(id) {
            if (!confirm('Are you sure you want to delete this booking? This cannot be undone.')) return;
            try {
                await Data.deleteReservation(id);
                UI.toast('Booking deleted', 'info');
                var content = document.getElementById('adminTabContent');
                if (content) renderAdminBookings(content);
            } catch (err) {
                UI.toast('Failed to delete booking', 'error');
            }
        },

        async viewReceipt(id) {
            const res = Data.getReservations().find(r => r.id === id);
            if (!res) return;
            const player = Data.getPlayer(res.playerId);
            const ss = [...res.slots].sort((a, b) => a.hour - b.hour);
            const statusBadge = res.paymentStatus === 'paid' ? '<span class="badge badge-success">Approved</span>'
                : res.paymentStatus === 'pending' ? '<span class="badge badge-warning">Pending</span>'
                : '<span class="badge badge-danger">Rejected</span>';
            var receiptHtml = '<p class="text-muted text-center" style="margin-top:12px;">Loading receipt...</p>';
            UI.showModal('Booking Details', `
                <div class="summary-row"><span class="label">Confirmation</span><span class="value"><code>${res.confirmationCode}</code></span></div>
                <div class="summary-row"><span class="label">Player</span><span class="value">${player ? escapeHtml(player.fullName) : 'Unknown'}</span></div>
                <div class="summary-row"><span class="label">Email</span><span class="value">${player ? escapeHtml(player.email) : 'N/A'}</span></div>
                <div class="summary-row"><span class="label">Facility</span><span class="value">${getCourtName(res.courtId)}${res.sport && res.sport !== 'pickleball' ? ' (' + formatSport(res.sport) + ')' : ''}</span></div>
                <div class="summary-row"><span class="label">Date</span><span class="value">${formatDate(res.date)}</span></div>
                <div class="summary-row"><span class="label">Time</span><span class="value">${formatHour(ss[0].hour)} – ${formatHour(ss[ss.length - 1].hour + 1)}</span></div>
                <div class="summary-row"><span class="label">Amount</span><span class="value">${formatCurrency(res.totalAmount)}</span></div>
                <div class="summary-row"><span class="label">Payment</span><span class="value">${res.paymentMethod.toUpperCase()}</span></div>
                <div class="summary-row"><span class="label">Status</span><span class="value">${statusBadge}</span></div>
                <h4 style="margin-top:16px; font-size:14px; font-weight:700;">Payment Receipt</h4>
                <div id="receiptContainer">${receiptHtml}</div>
            `, res.paymentStatus === 'pending'
                ? `<button class="btn btn-success" onclick="window.PKL.approveBooking('${res.id}'); window.PKL.closeModal();">Approve</button>
                   <button class="btn btn-danger" onclick="window.PKL.rejectBooking('${res.id}'); window.PKL.closeModal();">Reject</button>
                   <button class="btn btn-primary" onclick="window.PKL.closeModal();window.PKL.adminEditBooking('${res.id}')">Edit</button>
                   <button class="btn btn-outline" onclick="window.PKL.closeModal()">Close</button>`
                : `<button class="btn btn-primary" onclick="window.PKL.closeModal();window.PKL.adminEditBooking('${res.id}')">Edit</button>
                   <button class="btn btn-outline" onclick="window.PKL.closeModal()">Close</button>`
            );
            try {
                var full = await Data._api('reservations?id=' + id);
                var container = document.getElementById('receiptContainer');
                if (container && full && full.receiptImage && full.receiptImage.indexOf('data:image/') === 0) {
                    container.innerHTML = '<div style="margin-top:12px; text-align:center;"><img src="' + full.receiptImage + '" style="max-width:100%; max-height:400px; border-radius:8px; border:1px solid var(--gray-200);" alt="Payment Receipt"></div>';
                } else if (container) {
                    container.innerHTML = '<p class="text-muted text-center" style="margin-top:12px;">No receipt uploaded</p>';
                }
            } catch (err) {
                var container = document.getElementById('receiptContainer');
                if (container) container.innerHTML = '<p class="text-muted text-center" style="margin-top:12px;">Could not load receipt</p>';
            }
        },

        adminViewBooking(id) {
            const res = Data.getReservations().find(r => r.id === id);
            if (!res) return;
            const player = Data.getPlayer(res.playerId);
            const ss = [...res.slots].sort((a, b) => a.hour - b.hour);
            UI.showModal('Booking Details', `
                <div class="summary-row"><span class="label">Confirmation</span><span class="value"><code>${res.confirmationCode}</code></span></div>
                <div class="summary-row"><span class="label">Player</span><span class="value">${player ? escapeHtml(player.fullName) : 'Unknown'}</span></div>
                <div class="summary-row"><span class="label">Facility</span><span class="value">${getCourtName(res.courtId)}${res.sport && res.sport !== 'pickleball' ? ' (' + formatSport(res.sport) + ')' : ''}</span></div>
                <div class="summary-row"><span class="label">Date</span><span class="value">${formatDate(res.date)}</span></div>
                <div class="summary-row"><span class="label">Time</span><span class="value">${formatHour(ss[0].hour)} – ${formatHour(ss[ss.length - 1].hour + 1)}</span></div>
                <div class="summary-row"><span class="label">Amount</span><span class="value">${formatCurrency(res.totalAmount)}</span></div>
                <div class="summary-row"><span class="label">Payment</span><span class="value">${res.paymentMethod.toUpperCase()}</span></div>
                <div class="summary-row"><span class="label">Status</span><span class="value"><span class="badge ${res.paymentStatus === 'paid' ? 'badge-success' : res.paymentStatus === 'pending' ? 'badge-warning' : 'badge-danger'}">${res.paymentStatus === 'paid' ? 'Approved' : res.paymentStatus === 'pending' ? 'Pending' : res.paymentStatus}</span></span></div>
            `, `<button class="btn btn-primary" onclick="window.PKL.closeModal();window.PKL.adminEditBooking('${res.id}')">Edit</button>
                <button class="btn btn-outline" onclick="window.PKL.closeModal()">Close</button>`);
        },

        adminEditBooking(id) {
            var res = Data.getReservations().find(function(r) { return r.id === id; });
            if (!res) return;
            var player = Data.getPlayer(res.playerId);
            var editDate = res.date;
            var editCourtId = res.courtId;
            var editSport = res.sport || 'pickleball';
            var editSlots = res.slots.map(function(s) { return s.hour; });

            function renderEditModal() {
                var hours = getAvailableHours(editDate);
                var courtOptions = CONFIG.courts.map(function(c) {
                    var sel = c.id === editCourtId ? ' selected' : '';
                    return '<option value="' + c.id + '"' + sel + '>' + c.name + ' (' + c.label + ')</option>';
                }).join('');
                var courtCfg = getCourtConfig(editCourtId);
                var sportHtml = '';
                if (courtCfg && courtCfg.type === 'dual') {
                    sportHtml = '<div class="summary-row"><span class="label">Sport</span><span class="value">' +
                        '<select id="editSport" class="form-control" style="width:auto;display:inline-block;" onchange="window.PKL._editSport=this.value">' +
                            '<option value="pickleball"' + (editSport === 'pickleball' ? ' selected' : '') + '>Pickleball</option>' +
                            '<option value="badminton"' + (editSport === 'badminton' ? ' selected' : '') + '>Badminton</option>' +
                        '</select></span></div>';
                }
                var slotsHtml = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:6px;margin-top:8px;">';
                hours.forEach(function(h) {
                    var otherBooked = Data.getReservationsByCourtAndDate(editCourtId, editDate).some(function(r) {
                        return r.id !== id && r.slots.some(function(s) { return s.hour === h; });
                    });
                    var blocked = Data.isSlotBlocked(editCourtId, editDate, h);
                    var selected = editSlots.indexOf(h) >= 0;
                    if (blocked || otherBooked) {
                        slotsHtml += '<div style="padding:8px;border-radius:8px;text-align:center;font-size:13px;background:var(--gray-100);color:var(--gray-400);">' + formatHour(h) + ' ' + (blocked ? 'Blocked' : 'Taken') + '</div>';
                    } else {
                        var bg = selected ? 'var(--crimson)' : 'var(--gray-50)';
                        var color = selected ? '#fff' : 'var(--gray-700)';
                        slotsHtml += '<div style="padding:8px;border-radius:8px;text-align:center;font-size:13px;cursor:pointer;font-weight:' + (selected ? '600' : '400') + ';background:' + bg + ';color:' + color + ';border:1px solid ' + (selected ? 'var(--crimson)' : 'var(--gray-200)') + ';" onclick="window.PKL._toggleEditSlot(' + h + ')">' + formatHour(h) + '</div>';
                    }
                });
                slotsHtml += '</div>';

                var total = editSlots.length * getRate(editSlots[0] || hours[0], editCourtId, editSport);
                UI.showModal('Edit Booking', `
                    <div class="summary-row"><span class="label">Player</span><span class="value">${player ? escapeHtml(player.fullName) : 'Unknown'}</span></div>
                    <div class="summary-row"><span class="label">Date</span><span class="value">
                        <input type="date" id="editDate" class="form-control" style="width:auto;display:inline-block;" value="${editDate}" onchange="window.PKL._editDateChange(this.value)">
                    </span></div>
                    <div class="summary-row"><span class="label">Court</span><span class="value">
                        <select id="editCourt" class="form-control" style="width:auto;display:inline-block;" onchange="window.PKL._editCourtChange(parseInt(this.value))">
                            ${courtOptions}
                        </select>
                    </span></div>
                    ${sportHtml}
                    <h4 style="margin-top:16px;font-size:14px;font-weight:700;">Time Slots</h4>
                    <p style="font-size:12px;color:var(--gray-500);margin-bottom:8px;">Tap to select/deselect slots</p>
                    ${slotsHtml}
                    <div style="margin-top:16px;padding:12px;background:var(--gray-50);border-radius:8px;display:flex;justify-content:space-between;align-items:center;">
                        <span style="font-weight:600;">Total: ${formatCurrency(total)}</span>
                        <span style="font-size:13px;color:var(--gray-500);">${editSlots.length} slot${editSlots.length !== 1 ? 's' : ''}</span>
                    </div>
                `, `<button class="btn btn-primary" onclick="window.PKL._saveEditBooking('${id}')">Save Changes</button>
                    <button class="btn btn-outline" onclick="window.PKL.closeModal()">Cancel</button>`);
            }

            window.PKL._editDate = editDate;
            window.PKL._editCourtId = editCourtId;
            window.PKL._editSport = editSport;
            window.PKL._editSlots = editSlots;
            window.PKL._editResId = id;

            window.PKL._toggleEditSlot = function(h) {
                var idx = editSlots.indexOf(h);
                if (idx >= 0) editSlots.splice(idx, 1);
                else editSlots.push(h);
                window.PKL._editSlots = editSlots;
                renderEditModal();
            };
            window.PKL._editDateChange = function(val) {
                editDate = val;
                editSlots = [];
                window.PKL._editDate = val;
                window.PKL._editSlots = editSlots;
                renderEditModal();
            };
            window.PKL._editCourtChange = function(val) {
                editCourtId = val;
                editSlots = [];
                var cfg = getCourtConfig(val);
                if (cfg && cfg.type === 'dual') editSport = 'pickleball';
                else if (cfg && cfg.type === 'table-tennis') editSport = 'table-tennis';
                else editSport = 'pickleball';
                window.PKL._editCourtId = val;
                window.PKL._editSport = editSport;
                window.PKL._editSlots = editSlots;
                renderEditModal();
            };

            renderEditModal();
        },

        async _saveEditBooking(id) {
            var slots = (window.PKL._editSlots || []);
            if (slots.length === 0) {
                UI.toast('Please select at least one time slot', 'error');
                return;
            }
            var date = window.PKL._editDate;
            var courtId = window.PKL._editCourtId;
            var sport = window.PKL._editSport;
            var formattedSlots = slots.map(function(h) { return { hour: h, rate: getRate(h, courtId, sport) }; });
            var totalAmount = 0;
            formattedSlots.forEach(function(s) { totalAmount += s.rate; });
            try {
                await Data.updateReservation(id, {
                    date: date,
                    courtId: courtId,
                    sport: sport,
                    slots: formattedSlots,
                    totalAmount: totalAmount
                });
                UI.closeModal();
                UI.toast('Booking updated successfully', 'success');
                var content = document.getElementById('adminTabContent');
                if (content) {
                    if (State.admin.activeTab === 'schedule') renderAdminSchedule(content);
                    else renderAdminBookings(content);
                }
            } catch (err) {
                UI.toast('Failed to update booking: ' + err.message, 'error');
            }
        },

        async addOverride() {
            var courtCheckboxes = document.querySelectorAll('#overrideCourts input:checked');
            var courtIds = Array.from(courtCheckboxes).map(function(c) { return parseInt(c.value); });
            var dateStart = document.getElementById('overrideDateStart').value;
            var dateEnd = document.getElementById('overrideDateEnd').value;
            var hourCheckboxes = document.querySelectorAll('#overrideHours input:checked');
            var hours = Array.from(hourCheckboxes).map(function(c) { return parseInt(c.value); });
            var reason = document.getElementById('overrideReason').value.trim();

            if (courtIds.length === 0) { UI.toast('Please select at least one court', 'error'); return; }
            if (!dateStart || !dateEnd) { UI.toast('Please select a date range', 'error'); return; }
            if (dateEnd < dateStart) { UI.toast('End date must be on or after start date', 'error'); return; }
            if (hours.length === 0) { UI.toast('Please select at least one hour', 'error'); return; }
            if (!reason) { UI.toast('Please enter a reason', 'error'); return; }

            var dates = [];
            var d = new Date(dateStart + 'T00:00:00');
            var end = new Date(dateEnd + 'T00:00:00');
            while (d <= end) {
                dates.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'));
                d.setDate(d.getDate() + 1);
            }

            var count = 0;
            var skipped = 0;
            try {
                for (var ci = 0; ci < courtIds.length; ci++) {
                    for (var di = 0; di < dates.length; di++) {
                        for (var hi = 0; hi < hours.length; hi++) {
                            if (Data.isSlotBlocked(courtIds[ci], dates[di], hours[hi])) {
                                skipped++;
                                continue;
                            }
                            await Data.addOverride({ courtId: courtIds[ci], date: dates[di], hour: hours[hi], reason: reason });
                            count++;
                        }
                    }
                }
                var msg = count + ' slot' + (count !== 1 ? 's' : '') + ' blocked';
                if (skipped > 0) msg += ' (' + skipped + ' already blocked, skipped)';
                UI.toast(msg, 'success');
                const content = document.getElementById('adminTabContent');
                if (content) renderAdminOverrides(content);
            } catch (err) {
                UI.toast('Failed to block slots', 'error');
            }
        },

        async removeOverride(id) {
            try {
                await Data.removeOverride(id);
                UI.toast('Override removed', 'info');
                const content = document.getElementById('adminTabContent');
                if (content) renderAdminOverrides(content);
            } catch (err) {
                UI.toast('Failed to remove override', 'error');
            }
        },

        async deleteSelectedOverrides() {
            var checked = document.querySelectorAll('.override-check:checked');
            if (checked.length === 0) { UI.toast('No overrides selected', 'warning'); return; }
            if (!confirm('Delete ' + checked.length + ' selected override(s)?')) return;
            try {
                for (var i = 0; i < checked.length; i++) {
                    await Data.removeOverride(checked[i].value);
                }
                UI.toast(checked.length + ' override(s) deleted', 'info');
                var content = document.getElementById('adminTabContent');
                if (content) renderAdminOverrides(content);
            } catch (err) {
                UI.toast('Failed to delete overrides', 'error');
            }
        },

        editOverride(id) {
            var o = Data.getOverrides().find(function(ov) { return ov.id === id; });
            if (!o) return;
            var newReason = prompt('Edit reason for ' + getCourtName(o.courtId) + ' on ' + formatDate(o.date) + ' at ' + formatHour(o.hour) + ':', o.reason);
            if (newReason === null || newReason.trim() === '') return;
            Data._api('overrides', 'PATCH', { id: o.id, reason: newReason.trim() }).then(function() {
                o.reason = newReason.trim();
                UI.toast('Override updated', 'success');
                var content = document.getElementById('adminTabContent');
                if (content) renderAdminOverrides(content);
            }).catch(function() {
                UI.toast('Failed to update override', 'error');
            });
        },

        filterPlayers(query) {
            const rows = document.querySelectorAll('#playersTable tbody tr');
            const q = query.toLowerCase();
            rows.forEach(row => {
                const text = row.textContent.toLowerCase();
                row.style.display = text.includes(q) ? '' : 'none';
            });
        },

        weekNav(dir) {
            State.weekOffset += dir;
            if (State.weekOffset < 0) State.weekOffset = 0;
            handleRoute();
        },

        selectSport(sport) {
            State.booking.sport = sport;
            State.booking.slots = [];
            var content = document.getElementById('homeTabContent');
            if (content) renderBookTab(content);
        },

        viewPhoto(src) {
            UI.showModal('Photo', '<div style="text-align:center;"><img src="' + src + '" style="max-width:100%;max-height:80vh;border-radius:8px;" alt="Court photo"></div>');
        },

        homeTab(tab) {
            State.homeTab = tab;
            if (tab === 'book') State.bookingDate = State.bookingDate || todayStr();
            handleRoute();
        },

        gridSelectSlot(courtId, hour, sport) {
            var dateStr = State.bookingDate || todayStr();
            if (dateStr === todayStr() && hour < new Date().getHours()) {
                UI.toast('This time slot has already passed', 'error');
                return;
            }
            var courtCfg = getCourtConfig(courtId);
            if (sport === 'dual' && courtCfg && courtCfg.type === 'dual') {
                if (State.booking.court === courtId && State.booking.date === dateStr && State.booking.sport) {
                    sport = State.booking.sport;
                } else {
                    UI.showModal('Select Sport',
                        '<div style="display:flex;gap:12px;">' +
                            '<button class="btn btn-primary" style="flex:1;" onclick="window.PKL.closeModal();window.PKL.gridSelectSlot(' + courtId + ',' + hour + ',\'pickleball\')">Pickleball</button>' +
                            '<button class="btn btn-primary" style="flex:1;" onclick="window.PKL.closeModal();window.PKL.gridSelectSlot(' + courtId + ',' + hour + ',\'badminton\')">Badminton</button>' +
                        '</div>'
                    );
                    return;
                }
            }
            if (State.booking.court !== courtId || State.booking.date !== dateStr || State.booking.sport !== sport) {
                State.booking.court = courtId;
                State.booking.date = dateStr;
                State.booking.slots = [hour];
                State.booking.sport = sport;
            } else {
                var idx = State.booking.slots.indexOf(hour);
                if (idx >= 0) {
                    State.booking.slots.splice(idx, 1);
                    if (State.booking.slots.length === 0) {
                        State.booking.court = null;
                        State.booking.date = null;
                        State.booking.sport = null;
                    }
                } else {
                    State.booking.slots.push(hour);
                }
            }
            var content = document.getElementById('homeTabContent');
            if (content) renderBookTab(content);
        },

        bookingDateNav(dir) {
            var d = new Date(State.bookingDate + 'T00:00:00');
            d.setDate(d.getDate() + dir);
            var today = new Date();
            today.setHours(0, 0, 0, 0);
            if (d < today) return;
            State.bookingDate = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
            State.booking.slots = [];
            State.booking.court = null;
            State.booking.date = null;
            State.booking.sport = null;
            var content = document.getElementById('homeTabContent');
            if (content) renderBookTab(content);
        },

        bookingDateReset() {
            State.bookingDate = todayStr();
            State.booking.slots = [];
            State.booking.court = null;
            State.booking.date = null;
            State.booking.sport = null;
            var content = document.getElementById('homeTabContent');
            if (content) renderBookTab(content);
        }
    };

    // --- Initialize ---
    document.addEventListener('DOMContentLoaded', async function () {
        // Mobile nav toggle
        var navToggle = document.getElementById('navToggle');
        function toggleNav(e) {
            e.preventDefault();
            document.getElementById('navLinks').classList.toggle('open');
        }
        navToggle.addEventListener('click', toggleNav);
        navToggle.addEventListener('touchend', toggleNav);

        // Load data from database
        await Data.init();

        // Route handling
        window.addEventListener('hashchange', handleRoute);
        handleRoute();

        // Auto-refresh every 30 seconds for multi-device sync (data only, no re-render)
        setInterval(function() {
            Data.refresh();
        }, 30000);
    });
})();
