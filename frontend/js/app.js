const API_BASE = '';
let ws = null;
let currentBed = null;
let bedData = {};
let bedVitals = {};
let bedRisks = {};
let alerts = [];
let charts = {};
let miniChart = null;
let heatmapChart = null;
let selectedBedForDetail = null;

document.addEventListener('DOMContentLoaded', () => {
    initTabs();
    initCanvas();
    initCharts();
    loadInitialData();
    connectWebSocket();
    updateTime();
    setInterval(updateTime, 1000);
    setInterval(loadStatistics, 5000);
});

function initTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            document.getElementById('tab-' + tab).classList.add('active');

            if (tab === 'vitals' && charts.chartECG) {
                setTimeout(() => {
                    Object.values(charts).forEach(c => c && c.resize());
                }, 100);
            }
            if (tab === 'heatmap') {
                setTimeout(() => {
                    if (heatmapChart) heatmapChart.resize();
                    loadHeatmapData();
                }, 100);
            }
        });
    });
}

function initCanvas() {
    const canvas = document.getElementById('bedLayoutCanvas');
    const ctx = canvas.getContext('2d');

    canvas.addEventListener('click', (e) => {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        for (const bed of Object.values(bedData)) {
            const bx = bed.location_x;
            const by = bed.location_y;
            if (x >= bx - 40 && x <= bx + 40 && y >= by - 40 && y <= by + 40) {
                selectBed(bed.id);
                break;
            }
        }
    });

    drawBeds(ctx);
}

function drawBeds(ctx) {
    const canvas = ctx.canvas;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.strokeStyle = 'rgba(59, 130, 246, 0.1)';
    ctx.lineWidth = 1;
    for (let x = 0; x < canvas.width; x += 50) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
    }
    for (let y = 0; y < canvas.height; y += 50) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
    }

    for (let row = 0; row < 5; row++) {
        ctx.fillStyle = 'rgba(59, 130, 246, 0.08)';
        ctx.fillRect(10, row * 100 + 10, 1060, 80);
        ctx.fillStyle = '#3b82f6';
        ctx.font = 'bold 12px sans-serif';
        ctx.fillText(`病区 ${row + 1}`, 20, row * 100 + 30);
    }

    for (const bed of Object.values(bedData)) {
        drawSingleBed(ctx, bed);
    }
}

function drawSingleBed(ctx, bed) {
    const x = bed.location_x;
    const y = bed.location_y;
    const risk = bedRisks[bed.id];
    const vitals = bedVitals[bed.id];

    let riskLevel = 'normal';
    let riskColor = '#22c55e';

    if (risk) {
        const maxRisk = Math.max(risk.sofa_score / 12, risk.sepsis_probability, risk.cre_risk, risk.mrsa_risk);
        if (maxRisk > 0.7 || risk.sofa_score >= 6) {
            riskLevel = 'critical';
            riskColor = '#ef4444';
        } else if (maxRisk > 0.5 || risk.sofa_score >= 2) {
            riskLevel = 'warning';
            riskColor = '#f59e0b';
        }
    }

    if (riskLevel !== 'normal') {
        const pulse = (Math.sin(Date.now() / 300) + 1) / 2;
        ctx.beginPath();
        ctx.arc(x, y, 45 + pulse * 8, 0, Math.PI * 2);
        ctx.fillStyle = riskColor + '33';
        ctx.fill();
    }

    const bedWidth = 70;
    const bedHeight = 60;
    const bx = x - bedWidth / 2;
    const by = y - bedHeight / 2;

    ctx.fillStyle = riskLevel === 'critical' ? 'rgba(239, 68, 68, 0.25)'
        : riskLevel === 'warning' ? 'rgba(245, 158, 11, 0.25)'
        : 'rgba(30, 58, 100, 0.7)';
    ctx.strokeStyle = riskColor;
    ctx.lineWidth = 2;
    roundRect(ctx, bx, by, bedWidth, bedHeight, 8);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = '#fff';
    ctx.font = 'bold 13px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(bed.bed_code, x, by + 20);

    if (vitals) {
        ctx.font = '10px sans-serif';
        ctx.fillStyle = '#f87171';
        ctx.fillText(`❤ ${vitals.ecg ? vitals.ecg.toFixed(0) : '--'}`, x, by + 36);
        ctx.fillStyle = '#22c55e';
        ctx.fillText(`🩸 ${vitals.spo2 ? vitals.spo2.toFixed(0) : '--'}%`, x, by + 48);
    }

    if (risk && risk.sofa_score >= 2) {
        ctx.fillStyle = '#ef4444';
        ctx.beginPath();
        ctx.arc(x + bedWidth / 2 - 8, by - 6, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 9px sans-serif';
        ctx.fillText('!', x + bedWidth / 2 - 8, by - 3);
    }
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

function selectBed(bedId) {
    selectedBedForDetail = bedId;
    const bed = bedData[bedId];
    if (!bed) return;

    document.getElementById('panelEmpty').style.display = 'none';
    document.getElementById('panelContent').style.display = 'block';

    document.getElementById('detailBedCode').textContent = bed.bed_code;
    document.getElementById('detailPatientName').textContent = bed.patient_name;
    document.getElementById('detailPatientAge').textContent = bed.patient_age;
    document.getElementById('detailPatientGender').textContent = bed.patient_gender;

    updateBedDetail(bedId);
    loadBedVitalsChart(bedId);
}

function updateBedDetail(bedId) {
    const vitals = bedVitals[bedId];
    const risk = bedRisks[bedId];

    if (vitals) {
        document.getElementById('vitalECG').textContent = vitals.ecg ? vitals.ecg.toFixed(1) : '--';
        document.getElementById('vitalVent').textContent = vitals.ventilator ? vitals.ventilator.toFixed(1) : '--';
        document.getElementById('vitalSpO2').textContent = vitals.spo2 ? vitals.spo2.toFixed(1) : '--';
        document.getElementById('vitalTemp').textContent = vitals.temperature ? vitals.temperature.toFixed(1) : '--';
    }

    if (risk) {
        document.getElementById('detailSOFA').textContent = risk.sofa_score.toFixed(1);
        document.getElementById('detailSepsis').textContent = (risk.sepsis_probability * 100).toFixed(1) + '%';
        document.getElementById('detailCRE').textContent = (risk.cre_risk * 100).toFixed(1) + '%';
        document.getElementById('detailMRSA').textContent = (risk.mrsa_risk * 100).toFixed(1) + '%';
    }
}

function initCharts() {
    charts.chartECG = echarts.init(document.getElementById('chartECG'), 'dark');
    charts.chartVent = echarts.init(document.getElementById('chartVent'), 'dark');
    charts.chartSpO2 = echarts.init(document.getElementById('chartSpO2'), 'dark');
    charts.chartTemp = echarts.init(document.getElementById('chartTemp'), 'dark');
    miniChart = echarts.init(document.getElementById('miniChart'), 'dark');
    heatmapChart = echarts.init(document.getElementById('heatmapChart'), 'dark');

    const commonOption = (color, yMin, yMax) => ({
        backgroundColor: 'transparent',
        tooltip: { trigger: 'axis' },
        grid: { left: 50, right: 20, top: 20, bottom: 30 },
        xAxis: {
            type: 'time',
            axisLine: { lineStyle: { color: '#2a4a7a' } },
            axisLabel: { color: '#8b9bb4', fontSize: 10 }
        },
        yAxis: {
            type: 'value',
            min: yMin,
            max: yMax,
            axisLine: { lineStyle: { color: '#2a4a7a' } },
            axisLabel: { color: '#8b9bb4', fontSize: 10 },
            splitLine: { lineStyle: { color: 'rgba(42, 74, 122, 0.3)' } }
        },
        series: [{
            type: 'line',
            smooth: true,
            showSymbol: false,
            lineStyle: { color, width: 2 },
            areaStyle: {
                color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                    { offset: 0, color: color + '66' },
                    { offset: 1, color: color + '00' }
                ])
            },
            data: []
        }]
    });

    charts.chartECG.setOption(commonOption('#ef4444', 40, 180));
    charts.chartVent.setOption(commonOption('#8b5cf6', 5, 40));
    charts.chartSpO2.setOption(commonOption('#22c55e', 70, 100));
    charts.chartTemp.setOption(commonOption('#f97316', 35, 42));

    miniChart.setOption({
        backgroundColor: 'transparent',
        tooltip: { trigger: 'axis' },
        legend: {
            data: ['心率', '血氧'],
            textStyle: { color: '#8b9bb4', fontSize: 10 },
            top: 0
        },
        grid: { left: 40, right: 15, top: 25, bottom: 25 },
        xAxis: {
            type: 'time',
            axisLine: { lineStyle: { color: '#2a4a7a' } },
            axisLabel: { color: '#8b9bb4', fontSize: 9 }
        },
        yAxis: {
            type: 'value',
            axisLine: { lineStyle: { color: '#2a4a7a' } },
            axisLabel: { color: '#8b9bb4', fontSize: 9 },
            splitLine: { lineStyle: { color: 'rgba(42, 74, 122, 0.3)' } }
        },
        series: [
            { name: '心率', type: 'line', smooth: true, showSymbol: false,
              lineStyle: { color: '#ef4444', width: 1.5 }, data: [] },
            { name: '血氧', type: 'line', smooth: true, showSymbol: false,
              lineStyle: { color: '#22c55e', width: 1.5 }, data: [], yAxisIndex: 0 }
        ]
    });

    heatmapChart.setOption({
        backgroundColor: 'transparent',
        tooltip: {
            formatter: (p) => {
                if (p.data && p.data.value) {
                    return `床位: ICU-${String(p.data.bedId).padStart(3, '0')}<br/>
                            CRE风险: ${(p.data.cre * 100).toFixed(1)}%<br/>
                            MRSA风险: ${(p.data.mrsa * 100).toFixed(1)}%<br/>
                            综合风险: ${(p.data.value * 100).toFixed(1)}%`;
                }
                return '';
            }
        },
        visualMap: {
            min: 0,
            max: 1,
            calculable: true,
            orient: 'horizontal',
            left: 'center',
            bottom: 10,
            textStyle: { color: '#8b9bb4' },
            inRange: {
                color: ['#22c55e', '#84cc16', '#eab308', '#f97316', '#ef4444']
            }
        },
        grid: { left: 60, right: 60, top: 30, bottom: 60 },
        xAxis: {
            type: 'category',
            data: Array.from({length: 10}, (_, i) => `列${i+1}`),
            axisLine: { lineStyle: { color: '#2a4a7a' } },
            axisLabel: { color: '#8b9bb4' }
        },
        yAxis: {
            type: 'category',
            data: Array.from({length: 5}, (_, i) => `病区${i+1}`),
            axisLine: { lineStyle: { color: '#2a4a7a' } },
            axisLabel: { color: '#8b9bb4' }
        },
        series: [{
            name: '感染风险',
            type: 'heatmap',
            label: {
                show: true,
                color: '#fff',
                fontSize: 11,
                formatter: (p) => `ICU-${String(p.data.bedId).padStart(3, '0')}\n${(p.data.value * 100).toFixed(0)}%`
            },
            data: []
        }]
    });

    document.getElementById('bedSelect').addEventListener('change', loadVitalsForSelectedBed);
    document.getElementById('timeRange').addEventListener('change', loadVitalsForSelectedBed);

    window.addEventListener('resize', () => {
        Object.values(charts).forEach(c => c && c.resize());
        if (miniChart) miniChart.resize();
        if (heatmapChart) heatmapChart.resize();
    });
}

function loadInitialData() {
    fetch(API_BASE + '/api/beds')
        .then(r => r.json())
        .then(data => {
            data.forEach(bed => {
                bedData[bed.id] = bed;
            });
            populateBedSelect(data);
            drawBeds();
            setInterval(() => {
                const canvas = document.getElementById('bedLayoutCanvas');
                if (canvas) drawBeds(canvas.getContext('2d'));
            }, 1000);
        });

    loadStatistics();
    loadAlerts();
}

function populateBedSelect(beds) {
    const select = document.getElementById('bedSelect');
    beds.forEach(bed => {
        const opt = document.createElement('option');
        opt.value = bed.id;
        opt.textContent = `${bed.bed_code} - ${bed.patient_name}`;
        select.appendChild(opt);
    });
}

function loadStatistics() {
    fetch(API_BASE + '/api/statistics')
        .then(r => r.json())
        .then(s => {
            document.getElementById('totalBeds').textContent = s.total_beds;
            document.getElementById('occupiedBeds').textContent = s.occupied_beds;
            document.getElementById('activeAlerts').textContent = s.active_alerts;
            document.getElementById('highRiskSepsis').textContent = s.high_risk_sepsis;
            document.getElementById('highRiskInfection').textContent = s.high_risk_infection;
            document.getElementById('avgSOFA').textContent = s.avg_sofa_score.toFixed(1);
        });
}

function loadAlerts() {
    fetch(API_BASE + '/api/alerts/active')
        .then(r => r.json())
        .then(data => {
            alerts = data;
            renderAlerts();
        });
}

function renderAlerts() {
    const filter = document.querySelector('.filter-btn.active')?.dataset.filter || 'all';
    const list = document.getElementById('alertsList');

    let filtered = alerts;
    if (filter === 'unack') {
        filtered = alerts.filter(a => !a.acknowledged);
    } else if (filter !== 'all') {
        filtered = alerts.filter(a => a.alert_type === filter);
    }

    if (filtered.length === 0) {
        list.innerHTML = '<div class="alerts-empty">暂无告警</div>';
        return;
    }

    list.innerHTML = filtered.map(alert => {
        const icons = {
            sepsis: '🚨',
            cre_infection: '🦠',
            mrsa_infection: '🧫'
        };
        const types = {
            sepsis: '脓毒症预警',
            cre_infection: 'CRE感染风险',
            mrsa_infection: 'MRSA感染风险'
        };
        return `
        <div class="alert-item severity-${alert.severity} ${alert.acknowledged ? 'acknowledged' : ''}">
            <div class="alert-icon">${icons[alert.alert_type] || '⚠️'}</div>
            <div class="alert-main">
                <div class="alert-type">${types[alert.alert_type] || alert.alert_type} · ${alert.severity.toUpperCase()}</div>
                <div class="alert-message">${alert.message}</div>
            </div>
            <div class="alert-meta">
                <div class="alert-bed">ICU-${String(alert.bed_id).padStart(3, '0')}</div>
                <div class="alert-value">触发值: ${alert.trigger_value.toFixed(2)} / 阈值: ${alert.threshold}</div>
                <div>${new Date(alert.created_at).toLocaleString('zh-CN')}</div>
            </div>
            <div class="alert-actions">
                ${!alert.acknowledged ? `<button class="btn btn-primary" style="font-size:11px;padding:5px 10px;" onclick="acknowledgeAlert(${alert.id})">确认</button>` : `<span style="color:#22c55e;font-size:11px;">已确认</span>`}
            </div>
        </div>`;
    }).join('');

    document.querySelectorAll('.filter-btn').forEach(btn => {
        btn.onclick = () => {
            document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderAlerts();
        };
    });
}

function acknowledgeAlert(id) {
    fetch(API_BASE + `/api/alerts/${id}/acknowledge`, { method: 'POST' })
        .then(r => r.json())
        .then(() => loadAlerts());
}

function loadVitalsForSelectedBed() {
    const bedId = document.getElementById('bedSelect').value;
    if (!bedId) return;

    const seconds = document.getElementById('timeRange').value;
    fetch(API_BASE + `/api/beds/${bedId}/vitals/recent?seconds=${seconds}`)
        .then(r => r.json())
        .then(data => {
            updateChart(charts.chartECG, data.ecg || []);
            updateChart(charts.chartVent, data.ventilator || []);
            updateChart(charts.chartSpO2, data.spo2 || []);
            updateChart(charts.chartTemp, data.temperature || []);
        });
}

function updateChart(chart, points) {
    const data = points.map(p => [new Date(p.time).getTime(), p.value]);
    chart.setOption({ series: [{ data }] });
}

function loadBedVitalsChart(bedId) {
    fetch(API_BASE + `/api/beds/${bedId}/vitals/recent?seconds=300`)
        .then(r => r.json())
        .then(data => {
            const ecgData = (data.ecg || []).map(p => [new Date(p.time).getTime(), p.value]);
            const spo2Data = (data.spo2 || []).map(p => [new Date(p.time).getTime(), p.value]);
            miniChart.setOption({
                series: [
                    { data: ecgData },
                    { data: spo2Data }
                ]
            });
        });
}

function loadHeatmapData() {
    fetch(API_BASE + '/api/infection/risk')
        .then(r => r.json())
        .then(data => {
            const heatData = data.map(p => ({
                value: p.max_risk,
                bedId: p.bed_id,
                cre: p.cre_risk,
                mrsa: p.mrsa_risk
            }));

            heatData.forEach(item => {
                const bed = bedData[item.bedId];
                if (bed) {
                    const row = Math.floor((item.bedId - 1) / 10);
                    const col = (item.bedId - 1) % 10;
                    item.value = [col, row, item.max_risk];
                }
            });

            heatmapChart.setOption({ series: [{ data: heatData }] });
        });
}

function connectWebSocket() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${location.host}/ws`;

    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        document.getElementById('connectionStatus').textContent = '● 已连接';
        document.getElementById('connectionStatus').className = 'status-badge connected';
    };

    ws.onclose = () => {
        document.getElementById('connectionStatus').textContent = '● 已断开';
        document.getElementById('connectionStatus').className = 'status-badge disconnected';
        setTimeout(connectWebSocket, 3000);
    };

    ws.onerror = () => {
        document.getElementById('connectionStatus').textContent = '● 连接错误';
        document.getElementById('connectionStatus').className = 'status-badge disconnected';
    };

    ws.onmessage = (e) => {
        try {
            const msg = JSON.parse(e.data);
            if (msg.type === 'vitals_update') {
                handleVitalsUpdate(msg.data);
            } else if (msg.type === 'alert') {
                handleNewAlert(msg.data);
            }
        } catch (err) {
            console.error('WS解析错误:', err);
        }
    };
}

function handleVitalsUpdate(data) {
    data.forEach(item => {
        const bedId = item.bed.id;
        if (item.vitals) bedVitals[bedId] = item.vitals;
        if (item.risk) bedRisks[bedId] = item.risk;
    });

    if (selectedBedForDetail) {
        updateBedDetail(selectedBedForDetail);
    }
}

function handleNewAlert(alert) {
    alerts.unshift(alert);
    renderAlerts();
    loadStatistics();

    const toast = document.getElementById('alertToast');
    const typeNames = {
        sepsis: '脓毒症预警',
        cre_infection: 'CRE感染风险',
        mrsa_infection: 'MRSA感染风险'
    };
    toast.innerHTML = `
        <h4>⚠️ ${typeNames[alert.alert_type] || '告警'} - 床位ICU-${String(alert.bed_id).padStart(3, '0')}</h4>
        <p>${alert.message}</p>
    `;
    toast.classList.remove('hidden');
    setTimeout(() => toast.classList.add('hidden'), 5000);
}

function updateTime() {
    document.getElementById('currentTime').textContent = new Date().toLocaleString('zh-CN');
}

function showDetailVitals() {
    if (selectedBedForDetail) {
        document.querySelector('.tab-btn[data-tab="vitals"]').click();
        document.getElementById('bedSelect').value = selectedBedForDetail;
        loadVitalsForSelectedBed();
    }
}

function recordProcedure() {
    if (!selectedBedForDetail) return;
    const procType = prompt('请输入操作类型（如：气管插管、中心静脉置管等）:');
    if (!procType) return;

    fetch(API_BASE + `/api/beds/${selectedBedForDetail}/invasive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            bed_id: selectedBedForDetail,
            procedure_type: procType,
            procedure_time: new Date().toISOString(),
            notes: '前端记录'
        })
    }).then(r => r.json()).then(d => alert('操作已记录'));
}

function recordAntibiotic() {
    if (!selectedBedForDetail) return;
    const abType = prompt('请输入抗生素类型（如：美罗培南、万古霉素等）:');
    if (!abType) return;
    const dosage = parseFloat(prompt('请输入剂量(g):', '1.0') || '1');

    fetch(API_BASE + `/api/beds/${selectedBedForDetail}/antibiotics`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            bed_id: selectedBedForDetail,
            antibiotic_type: abType,
            dosage: dosage,
            start_date: new Date().toISOString(),
            end_date: new Date(Date.now() + 7 * 86400000).toISOString()
        })
    }).then(r => r.json()).then(d => alert('抗生素已记录'));
}
