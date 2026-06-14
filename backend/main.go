package main

import (
	"log"
	"field-hospital-icu/config"
	"field-hospital-icu/database"
	"field-hospital-icu/mqtt"
	"field-hospital-icu/handlers"
	"field-hospital-icu/ml"
	"field-hospital-icu/alert"
	"github.com/gin-gonic/gin"
	"github.com/gin-contrib/cors"
	"time"
)

func main() {
	log.Println("=== 战地医院移动ICU生命体征监测系统启动 ===")

	config.LoadConfig()
	log.Println("配置加载完成")

	database.InitDB()
	defer database.CloseDB()
	log.Println("数据库连接成功")

	database.InitSchema()
	log.Println("数据库Schema初始化完成")

	database.SeedBedData()
	log.Println("床位数据初始化完成")

	database.InitBatchWriter()
	defer database.VitalWriter.Stop()
	log.Println("批量写入器启动完成")

	alert.InitAlertSystem()
	log.Println("告警系统初始化完成")

	ml.InitMLModels()
	ml.InitMAML()
	log.Println("机器学习模型加载完成（含MAML元学习）")

	mqtt.InitMQTT()
	defer mqtt.CloseMQTT()
	log.Println("MQTT连接成功（持久会话）")

	go ml.StartPeriodicPrediction()
	log.Println("定时预测任务已启动")

	r := gin.Default()

	r.Use(cors.New(cors.Config{
		AllowAllOrigins:  true,
		AllowMethods:     []string{"GET", "POST", "PUT", "DELETE", "OPTIONS"},
		AllowHeaders:     []string{"Origin", "Content-Type", "Authorization"},
		ExposeHeaders:    []string{"Content-Length"},
		AllowCredentials: true,
		MaxAge:           12 * time.Hour,
	}))

	r.Static("/css", "./frontend/css")
	r.Static("/js", "./frontend/js")
	r.StaticFile("/", "./frontend/index.html")

	api := r.Group("/api")
	{
		api.GET("/beds", handlers.GetBeds)
		api.GET("/beds/:id", handlers.GetBedByID)
		api.GET("/beds/:id/vitals", handlers.GetBedVitals)
		api.GET("/beds/:id/vitals/recent", handlers.GetRecentVitals)
		api.GET("/alerts", handlers.GetAlerts)
		api.GET("/alerts/active", handlers.GetActiveAlerts)
		api.GET("/infection/risk", handlers.GetInfectionRiskMap)
		api.GET("/statistics", handlers.GetStatistics)
		api.POST("/beds/:id/antibiotics", handlers.RecordAntibiotic)
		api.POST("/beds/:id/invasive", handlers.RecordInvasiveProcedure)
		api.POST("/alerts/:id/acknowledge", handlers.AcknowledgeAlert)
	}

	r.GET("/ws", handlers.WebSocketHandler)

	log.Printf("HTTP服务启动，监听端口: %s", config.AppConfig.Server.Port)
	if err := r.Run(":" + config.AppConfig.Server.Port); err != nil {
		log.Fatalf("服务启动失败: %v", err)
	}
}
