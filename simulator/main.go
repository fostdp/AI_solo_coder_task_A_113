package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"math"
	"math/rand"
	"os"
	"os/signal"
	"syscall"
	"time"

	mqtt "github.com/eclipse/paho.mqtt.golang"
)

type SensorMessage struct {
	BedID      int     `json:"bed_id"`
	SensorType string  `json:"sensor_type"`
	Value      float64 `json:"value"`
	Unit       string  `json:"unit"`
	Timestamp  int64   `json:"timestamp"`
}

type SensorConfig struct {
	Type       string
	Name       string
	BaseValue  float64
	MinNormal  float64
	MaxNormal  float64
	MinRange   float64
	MaxRange   float64
	Unit       string
	AnomalyChance float64
}

func main() {
	broker := flag.String("broker", "tcp://localhost:1883", "MQTT broker地址")
	clientID := flag.String("clientid", "sensor-simulator", "MQTT客户端ID")
	interval := flag.Int("interval", 1000, "上报间隔(毫秒)")
	numBeds := flag.Int("beds", 50, "床位数量")
	flag.Parse()

	log.Println("=== 战地医院ICU传感器模拟器启动 ===")
	log.Printf("Broker: %s", *broker)
	log.Printf("床位: %d, 传感器: %d", *numBeds, *numBeds*4)
	log.Printf("上报间隔: %dms", *interval)

	sensors := []SensorConfig{
		{
			Type:          "ecg",
			Name:          "心电监护",
			BaseValue:     75,
			MinNormal:     60,
			MaxNormal:     100,
			MinRange:      40,
			MaxRange:      180,
			Unit:          "bpm",
			AnomalyChance: 0.05,
		},
		{
			Type:          "ventilator",
			Name:          "呼吸机频率",
			BaseValue:     18,
			MinNormal:     12,
			MaxNormal:     24,
			MinRange:      6,
			MaxRange:      40,
			Unit:          "rpm",
			AnomalyChance: 0.03,
		},
		{
			Type:          "spo2",
			Name:          "血氧饱和度",
			BaseValue:     96,
			MinNormal:     94,
			MaxNormal:     100,
			MinRange:      70,
			MaxRange:      100,
			Unit:          "%",
			AnomalyChance: 0.04,
		},
		{
			Type:          "temperature",
			Name:          "体温",
			BaseValue:     36.8,
			MinNormal:     36.5,
			MaxNormal:     37.5,
			MinRange:      35,
			MaxRange:      41,
			Unit:          "°C",
			AnomalyChance: 0.02,
		},
	}

	opts := mqtt.NewClientOptions()
	opts.AddBroker(*broker)
	opts.SetClientID(*clientID + "-persistent")
	opts.SetCleanSession(false)
	opts.SetAutoReconnect(true)
	opts.SetConnectRetry(true)
	opts.SetConnectRetryInterval(3 * time.Second)
	opts.SetMaxReconnectInterval(1 * time.Minute)
	opts.SetKeepAlive(60 * time.Second)
	opts.SetOnConnectHandler(func(c mqtt.Client) {
		log.Println("MQTT已连接 (持久会话模式)")
	})
	opts.SetConnectionLostHandler(func(c mqtt.Client, err error) {
		log.Printf("MQTT连接断开: %v (消息不会丢失，Broker已持久化)", err)
	})

	client := mqtt.NewClient(opts)
	token := client.Connect()
	token.Wait()
	if token.Error() != nil {
		log.Fatalf("MQTT连接失败: %v", token.Error())
	}

	bedStates := make(map[int]map[string]float64)
	for i := 1; i <= *numBeds; i++ {
		bedStates[i] = make(map[string]float64)
		for _, s := range sensors {
			bedStates[i][s.Type] = s.BaseValue
		}
	}

	sigChan := make(chan os.Signal, 1)
	signal.Notify(sigChan, syscall.SIGINT, syscall.SIGTERM)

	ticker := time.NewTicker(time.Duration(*interval) * time.Millisecond)
	defer ticker.Stop()

	count := 0
	for {
		select {
		case <-sigChan:
			log.Println("收到停止信号，模拟器退出")
			client.Disconnect(250)
			return
		case t := <-ticker.C:
			count++
			totalSent := 0

			for bedID := 1; bedID <= *numBeds; bedID++ {
				for _, s := range sensors {
					currentVal := bedStates[bedID][s.Type]
					var newVal float64

					isAnomaly := rand.Float64() < s.AnomalyChance

					if isAnomaly {
						anomalyDir := 1.0
						if rand.Float64() < 0.5 {
							anomalyDir = -1.0
						}
						newVal = currentVal + anomalyDir*(s.MaxRange-s.MinRange)*0.15
						log.Printf("[异常] 床位%d %s: %.2f -> %.2f", bedID, s.Name, currentVal, newVal)
					} else {
						drift := (rand.Float64() - 0.5) * (s.MaxNormal - s.MinNormal) * 0.05
						newVal = currentVal + drift

						targetDiff := s.BaseValue - newVal
						newVal += targetDiff * 0.02

						wave := math.Sin(float64(count)/10.0+float64(bedID)) * (s.MaxNormal - s.MinNormal) * 0.02
						newVal += wave
					}

					newVal = math.Max(s.MinRange, math.Min(s.MaxRange, newVal))
					bedStates[bedID][s.Type] = newVal

					msg := SensorMessage{
						BedID:      bedID,
						SensorType: s.Type,
						Value:      roundTo(newVal, 2),
						Unit:       s.Unit,
						Timestamp:  t.Unix(),
					}

					payload, _ := json.Marshal(msg)
					topic := fmt.Sprintf("icu/bed/%d/%s", bedID, s.Type)

					token := client.Publish(topic, 1, false, payload)
					token.WaitTimeout(100 * time.Millisecond)
					totalSent++
				}
			}

			if count%10 == 0 {
				log.Printf("已发送 %d 条消息 (总 %d)", totalSent, count**numBeds*len(sensors))
			}
		}
	}
}

func roundTo(val float64, precision int) float64 {
	mult := math.Pow10(precision)
	return math.Round(val*mult) / mult
}
