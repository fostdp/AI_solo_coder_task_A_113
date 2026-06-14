package config

import (
	"log"
	"github.com/spf13/viper"
)

type Config struct {
	Server      ServerConfig
	Database    DatabaseConfig
	MQTT        MQTTConfig
	Alert       AlertConfig
	ML          MLConfig
}

type ServerConfig struct {
	Port string
}

type DatabaseConfig struct {
	Host     string
	Port     string
	User     string
	Password string
	DBName   string
	SSLMode  string
}

type MQTTConfig struct {
	Broker   string
	ClientID string
	Username string
	Password string
	QoS      byte
}

type AlertConfig struct {
	SofaThreshold     float64
	InfectionThreshold float64
	SMSGateway        string
}

type MLConfig struct {
	LSTMSequenceLength  int
	ModelUpdateInterval int
}

var AppConfig Config

func LoadConfig() {
	viper.SetConfigName("config")
	viper.SetConfigType("yaml")
	viper.AddConfigPath("./config")
	viper.AddConfigPath(".")

	viper.SetDefault("server.port", "8080")
	viper.SetDefault("database.host", "localhost")
	viper.SetDefault("database.port", "5432")
	viper.SetDefault("database.user", "postgres")
	viper.SetDefault("database.password", "postgres")
	viper.SetDefault("database.dbname", "field_hospital")
	viper.SetDefault("database.sslmode", "disable")
	viper.SetDefault("mqtt.broker", "tcp://localhost:1883")
	viper.SetDefault("mqtt.clientid", "field-hospital-backend")
	viper.SetDefault("mqtt.qos", 1)
	viper.SetDefault("alert.sofathreshold", 2.0)
	viper.SetDefault("alert.infectionthreshold", 0.7)
	viper.SetDefault("alert.smsgateway", "http://localhost:9090/sms")
	viper.SetDefault("ml.lstmsequencelength", 60)
	viper.SetDefault("ml.modelupdateinterval", 300)

	if err := viper.ReadInConfig(); err != nil {
		log.Printf("Warning: Config file not found, using defaults: %v", err)
	}

	if err := viper.Unmarshal(&AppConfig); err != nil {
		log.Fatalf("Unable to decode config: %v", err)
	}
}
