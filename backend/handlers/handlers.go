package handlers

import (
	"context"
	"net/http"
	"strconv"
	"time"
	"field-hospital-icu/database"
	"field-hospital-icu/models"
	"field-hospital-icu/ml"
	"field-hospital-icu/alert"
	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

func GetBeds(c *gin.Context) {
	rows, err := database.DB.Query(context.Background(),
		`SELECT id, bed_code, patient_name, patient_age, patient_gender, status, admission_time, location_x, location_y, created_at
		 FROM beds ORDER BY id`)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	beds := make([]models.Bed, 0)
	for rows.Next() {
		var b models.Bed
		if err := rows.Scan(&b.ID, &b.BedCode, &b.PatientName, &b.PatientAge,
			&b.PatientGender, &b.Status, &b.AdmissionTime, &b.LocationX, &b.LocationY, &b.CreatedAt); err == nil {
			beds = append(beds, b)
		}
	}

	c.JSON(200, beds)
}

func GetBedByID(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))

	var b models.Bed
	err := database.DB.QueryRow(context.Background(),
		`SELECT id, bed_code, patient_name, patient_age, patient_gender, status, admission_time, location_x, location_y, created_at
		 FROM beds WHERE id = $1`, id).Scan(&b.ID, &b.BedCode, &b.PatientName, &b.PatientAge,
		&b.PatientGender, &b.Status, &b.AdmissionTime, &b.LocationX, &b.LocationY, &b.CreatedAt)
	if err != nil {
		c.JSON(404, gin.H{"error": "床位不存在"})
		return
	}

	c.JSON(200, b)
}

func GetBedVitals(c *gin.Context) {
	bedID, _ := strconv.Atoi(c.Param("id"))
	hours := 1
	if h := c.Query("hours"); h != "" {
		if hi, err := strconv.Atoi(h); err == nil && hi > 0 {
			hours = hi
		}
	}

	rows, err := database.DB.Query(context.Background(),
		`SELECT time, bed_id, sensor_type, value, unit
		 FROM vital_signs
		 WHERE bed_id = $1 AND time > NOW() - $2::interval
		 ORDER BY time ASC`,
		bedID, strconv.Itoa(hours)+" hours")
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	result := make(map[string][]models.VitalSign)
	for rows.Next() {
		var v models.VitalSign
		if err := rows.Scan(&v.Time, &v.BedID, &v.SensorType, &v.Value, &v.Unit); err == nil {
			result[v.SensorType] = append(result[v.SensorType], v)
		}
	}

	c.JSON(200, result)
}

func GetRecentVitals(c *gin.Context) {
	bedID, _ := strconv.Atoi(c.Param("id"))
	seconds := 60
	if s := c.Query("seconds"); s != "" {
		if si, err := strconv.Atoi(s); err == nil && si > 0 {
			seconds = si
		}
	}

	rows, err := database.DB.Query(context.Background(),
		`SELECT time, bed_id, sensor_type, value, unit
		 FROM vital_signs
		 WHERE bed_id = $1 AND time > NOW() - $2::interval
		 ORDER BY time ASC`,
		bedID, strconv.Itoa(seconds)+" seconds")
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	result := make(map[string][]models.VitalSign)
	for rows.Next() {
		var v models.VitalSign
		if err := rows.Scan(&v.Time, &v.BedID, &v.SensorType, &v.Value, &v.Unit); err == nil {
			result[v.SensorType] = append(result[v.SensorType], v)
		}
	}

	c.JSON(200, result)
}

func GetAlerts(c *gin.Context) {
	limit := 100
	if l := c.Query("limit"); l != "" {
		if li, err := strconv.Atoi(l); err == nil && li > 0 {
			limit = li
		}
	}

	rows, err := database.DB.Query(context.Background(),
		`SELECT id, bed_id, alert_type, severity, message, trigger_value, threshold,
		        acknowledged, acknowledged_by, acknowledged_at, created_at
		 FROM alerts ORDER BY created_at DESC LIMIT $1`, limit)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	alerts := make([]models.Alert, 0)
	for rows.Next() {
		var a models.Alert
		if err := rows.Scan(&a.ID, &a.BedID, &a.AlertType, &a.Severity, &a.Message,
			&a.TriggerValue, &a.Threshold, &a.Acknowledged, &a.AcknowledgedBy,
			&a.AcknowledgedAt, &a.CreatedAt); err == nil {
			alerts = append(alerts, a)
		}
	}

	c.JSON(200, alerts)
}

func GetActiveAlerts(c *gin.Context) {
	rows, err := database.DB.Query(context.Background(),
		`SELECT id, bed_id, alert_type, severity, message, trigger_value, threshold,
		        acknowledged, acknowledged_by, acknowledged_at, created_at
		 FROM alerts WHERE acknowledged = FALSE ORDER BY created_at DESC`)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	alerts := make([]models.Alert, 0)
	for rows.Next() {
		var a models.Alert
		if err := rows.Scan(&a.ID, &a.BedID, &a.AlertType, &a.Severity, &a.Message,
			&a.TriggerValue, &a.Threshold, &a.Acknowledged, &a.AcknowledgedBy,
			&a.AcknowledgedAt, &a.CreatedAt); err == nil {
			alerts = append(alerts, a)
		}
	}

	c.JSON(200, alerts)
}

func GetInfectionRiskMap(c *gin.Context) {
	rows, err := database.DB.Query(context.Background(),
		`SELECT b.id, b.bed_code, b.location_x, b.location_y
		 FROM beds b ORDER BY b.id`)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}
	defer rows.Close()

	beds := make([]models.InfectionRiskPoint, 0)
	predictions := ml.GetLatestPredictions()

	for rows.Next() {
		var p models.InfectionRiskPoint
		if err := rows.Scan(&p.BedID, &p.BedCode, &p.X, &p.Y); err == nil {
			if pred, ok := predictions[p.BedID]; ok {
				p.CRERisk = pred.CRERisk
				p.MRSARisk = pred.MRSARisk
				if p.CRERisk > p.MRSARisk {
					p.MaxRisk = p.CRERisk
				} else {
					p.MaxRisk = p.MRSARisk
				}
			}
			beds = append(beds, p)
		}
	}

	c.JSON(200, beds)
}

func GetStatistics(c *gin.Context) {
	var stats models.Statistics
	stats.LastUpdate = time.Now()

	database.DB.QueryRow(context.Background(), "SELECT COUNT(*) FROM beds").Scan(&stats.TotalBeds)
	database.DB.QueryRow(context.Background(),
		"SELECT COUNT(*) FROM beds WHERE status = 'occupied'").Scan(&stats.OccupiedBeds)
	database.DB.QueryRow(context.Background(),
		"SELECT COUNT(*) FROM alerts WHERE acknowledged = FALSE").Scan(&stats.ActiveAlerts)

	predictions := ml.GetLatestPredictions()
	var totalSOFA float64
	for _, p := range predictions {
		totalSOFA += p.SOFAScore
		if p.SepsisProbability > 0.7 {
			stats.HighRiskSepsis++
		}
		if p.CRERisk > 0.7 || p.MRSARisk > 0.7 {
			stats.HighRiskInfection++
		}
	}
	if len(predictions) > 0 {
		stats.AvgSOFAScore = totalSOFA / float64(len(predictions))
	}

	c.JSON(200, stats)
}

func RecordAntibiotic(c *gin.Context) {
	bedID, _ := strconv.Atoi(c.Param("id"))

	var record models.AntibioticRecord
	if err := c.ShouldBindJSON(&record); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	record.BedID = bedID

	_, err := database.DB.Exec(context.Background(),
		`INSERT INTO infection_history (bed_id, antibiotic_type, dosage, start_date, end_date)
		 VALUES ($1, $2, $3, $4, $5)`,
		record.BedID, record.AntibioticType, record.Dosage, record.StartDate, record.EndDate)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}

	c.JSON(200, gin.H{"status": "ok"})
}

func RecordInvasiveProcedure(c *gin.Context) {
	bedID, _ := strconv.Atoi(c.Param("id"))

	var proc models.InvasiveProcedure
	if err := c.ShouldBindJSON(&proc); err != nil {
		c.JSON(400, gin.H{"error": err.Error()})
		return
	}
	proc.BedID = bedID

	_, err := database.DB.Exec(context.Background(),
		`INSERT INTO invasive_procedures (bed_id, procedure_type, procedure_time, notes)
		 VALUES ($1, $2, $3, $4)`,
		proc.BedID, proc.ProcedureType, proc.ProcedureTime, proc.Notes)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}

	c.JSON(200, gin.H{"status": "ok"})
}

func AcknowledgeAlert(c *gin.Context) {
	id, _ := strconv.Atoi(c.Param("id"))
	user := c.DefaultQuery("user", "system")

	_, err := database.DB.Exec(context.Background(),
		`UPDATE alerts SET acknowledged = TRUE, acknowledged_by = $1, acknowledged_at = NOW() WHERE id = $2`,
		user, id)
	if err != nil {
		c.JSON(500, gin.H{"error": err.Error()})
		return
	}

	alert.BroadcastMessage("alert_ack", gin.H{"id": id, "user": user})
	c.JSON(200, gin.H{"status": "ok"})
}

func WebSocketHandler(c *gin.Context) {
	conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
	if err != nil {
		return
	}

	alert.RegisterClient(conn)
	defer func() {
		alert.UnregisterClient(conn)
		conn.Close()
	}()

	for {
		_, _, err := conn.ReadMessage()
		if err != nil {
			break
		}
	}
}
