CREATE TYPE "public"."driver_status" AS ENUM('offline', 'online', 'busy');--> statement-breakpoint
CREATE TYPE "public"."gender" AS ENUM('female', 'male', 'non_binary', 'undisclosed');--> statement-breakpoint
CREATE TYPE "public"."group_status" AS ENUM('accepting', 'dispatching', 'assigned', 'arrived', 'on_trip', 'completed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."hub_type" AS ENUM('airport', 'railway', 'bus');--> statement-breakpoint
CREATE TYPE "public"."offer_status" AS ENUM('pending', 'accepted', 'rejected', 'expired');--> statement-breakpoint
CREATE TYPE "public"."ride_status" AS ENUM('pending', 'matched', 'confirmed', 'picked_up', 'completed', 'cancelled', 'no_show', 'expired');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('rider', 'driver', 'admin');--> statement-breakpoint
CREATE TYPE "public"."safety_event_type" AS ENUM('sos', 'route_deviation', 'unexpected_stop', 'speeding', 'check_in_missed', 'check_in_ok', 'trip_shared');--> statement-breakpoint
CREATE TYPE "public"."severity" AS ENUM('info', 'warning', 'critical');--> statement-breakpoint
CREATE TYPE "public"."sos_status" AS ENUM('open', 'acknowledged', 'resolved', 'false_alarm');--> statement-breakpoint
CREATE TYPE "public"."vehicle_type" AS ENUM('hatchback', 'sedan', 'suv');--> statement-breakpoint
CREATE TABLE "driver_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"driver_id" uuid NOT NULL,
	"status" "offer_status" DEFAULT 'pending' NOT NULL,
	"distance_to_hub_km" double precision NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drivers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"status" "driver_status" DEFAULT 'offline' NOT NULL,
	"verified" boolean DEFAULT false NOT NULL,
	"license_number" text NOT NULL,
	"vehicle_number" text NOT NULL,
	"vehicle_model" text NOT NULL,
	"vehicle_color" text NOT NULL,
	"vehicle_type" "vehicle_type" DEFAULT 'sedan' NOT NULL,
	"seats" integer DEFAULT 4 NOT NULL,
	"luggage_capacity" integer DEFAULT 4 NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"heading" double precision,
	"location_updated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "location_pings" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"driver_id" uuid NOT NULL,
	"group_id" uuid,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"heading" double precision,
	"speed_kmh" double precision,
	"accuracy_m" double precision,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"link" text,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "otp_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"code_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ratings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ride_id" uuid NOT NULL,
	"rater_id" uuid NOT NULL,
	"ratee_id" uuid NOT NULL,
	"score" integer NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"comment" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"user_agent" text,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ride_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station_id" uuid NOT NULL,
	"status" "group_status" DEFAULT 'accepting' NOT NULL,
	"driver_id" uuid,
	"pickup_at" timestamp with time zone NOT NULL,
	"route_km" double precision DEFAULT 0 NOT NULL,
	"group_fare" double precision DEFAULT 0 NOT NULL,
	"platform_subsidy" double precision DEFAULT 0 NOT NULL,
	"women_only" boolean DEFAULT false NOT NULL,
	"prefer_female_driver" boolean DEFAULT false NOT NULL,
	"route" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"accept_expires_at" timestamp with time zone,
	"dispatch_started_at" timestamp with time zone,
	"assigned_at" timestamp with time zone,
	"arrived_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"driver_net" double precision,
	"driver_bonus" double precision,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ride_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"group_id" uuid,
	"status" "ride_status" DEFAULT 'pending' NOT NULL,
	"dest_lat" double precision NOT NULL,
	"dest_lng" double precision NOT NULL,
	"destination_label" text NOT NULL,
	"arrival_at" timestamp with time zone NOT NULL,
	"tolerance_min" integer DEFAULT 15 NOT NULL,
	"seats" integer DEFAULT 1 NOT NULL,
	"luggage" integer DEFAULT 1 NOT NULL,
	"flight_or_train" text,
	"women_only" boolean DEFAULT false NOT NULL,
	"prefer_female_driver" boolean DEFAULT false NOT NULL,
	"solo_km" double precision NOT NULL,
	"solo_fare" double precision NOT NULL,
	"quoted_fare" double precision,
	"accepted_fare" double precision,
	"final_fare" double precision,
	"platform_subsidy" double precision DEFAULT 0 NOT NULL,
	"drop_index" integer,
	"pickup_pin" text NOT NULL,
	"pin_attempts" integer DEFAULT 0 NOT NULL,
	"accepted_at" timestamp with time zone,
	"picked_up_at" timestamp with time zone,
	"dropped_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"cancel_reason" text,
	"decline_count" integer DEFAULT 0 NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "safety_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" "safety_event_type" NOT NULL,
	"severity" "severity" DEFAULT 'info' NOT NULL,
	"group_id" uuid,
	"ride_id" uuid,
	"user_id" uuid,
	"message" text NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"check_in_deadline" timestamp with time zone,
	"check_in_resolved_at" timestamp with time zone,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sos_incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"ride_id" uuid,
	"group_id" uuid,
	"driver_id" uuid,
	"status" "sos_status" DEFAULT 'open' NOT NULL,
	"lat" double precision,
	"lng" double precision,
	"message" text,
	"note" text,
	"handled_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" "hub_type" NOT NULL,
	"city" text NOT NULL,
	"lat" double precision NOT NULL,
	"lng" double precision NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trip_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token" text NOT NULL,
	"ride_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trusted_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"phone" text NOT NULL,
	"email" text,
	"relation" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"phone" text,
	"gender" "gender" DEFAULT 'undisclosed' NOT NULL,
	"role" "role" DEFAULT 'rider' NOT NULL,
	"avatar_url" text,
	"email_verified" boolean DEFAULT false NOT NULL,
	"onboarded" boolean DEFAULT false NOT NULL,
	"rating_sum" integer DEFAULT 0 NOT NULL,
	"rating_count" integer DEFAULT 0 NOT NULL,
	"safety" jsonb DEFAULT '{"autoShareTrips":true,"nightCheckIns":true,"womenOnlyDefault":false,"preferFemaleDriver":false}'::jsonb NOT NULL,
	"simulated" boolean DEFAULT false NOT NULL,
	"suspended" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "driver_offers" ADD CONSTRAINT "driver_offers_group_id_ride_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."ride_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "driver_offers" ADD CONSTRAINT "driver_offers_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drivers" ADD CONSTRAINT "drivers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_pings" ADD CONSTRAINT "location_pings_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "location_pings" ADD CONSTRAINT "location_pings_group_id_ride_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."ride_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_ride_id_ride_requests_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."ride_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_rater_id_users_id_fk" FOREIGN KEY ("rater_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_ratee_id_users_id_fk" FOREIGN KEY ("ratee_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ride_groups" ADD CONSTRAINT "ride_groups_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ride_groups" ADD CONSTRAINT "ride_groups_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ride_requests" ADD CONSTRAINT "ride_requests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ride_requests" ADD CONSTRAINT "ride_requests_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ride_requests" ADD CONSTRAINT "ride_requests_group_id_ride_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."ride_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_events" ADD CONSTRAINT "safety_events_group_id_ride_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."ride_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_events" ADD CONSTRAINT "safety_events_ride_id_ride_requests_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."ride_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safety_events" ADD CONSTRAINT "safety_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sos_incidents" ADD CONSTRAINT "sos_incidents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sos_incidents" ADD CONSTRAINT "sos_incidents_ride_id_ride_requests_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."ride_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sos_incidents" ADD CONSTRAINT "sos_incidents_group_id_ride_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."ride_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sos_incidents" ADD CONSTRAINT "sos_incidents_driver_id_drivers_id_fk" FOREIGN KEY ("driver_id") REFERENCES "public"."drivers"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sos_incidents" ADD CONSTRAINT "sos_incidents_handled_by_users_id_fk" FOREIGN KEY ("handled_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_shares" ADD CONSTRAINT "trip_shares_ride_id_ride_requests_id_fk" FOREIGN KEY ("ride_id") REFERENCES "public"."ride_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trip_shares" ADD CONSTRAINT "trip_shares_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trusted_contacts" ADD CONSTRAINT "trusted_contacts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "offers_group_driver_uq" ON "driver_offers" USING btree ("group_id","driver_id");--> statement-breakpoint
CREATE INDEX "offers_status_idx" ON "driver_offers" USING btree ("status","expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "drivers_user_uq" ON "drivers" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "drivers_vehicle_uq" ON "drivers" USING btree ("vehicle_number");--> statement-breakpoint
CREATE INDEX "drivers_status_idx" ON "drivers" USING btree ("status");--> statement-breakpoint
CREATE INDEX "pings_group_idx" ON "location_pings" USING btree ("group_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "otp_email_idx" ON "otp_codes" USING btree ("email","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ratings_ride_rater_uq" ON "ratings" USING btree ("ride_id","rater_id");--> statement-breakpoint
CREATE UNIQUE INDEX "refresh_hash_uq" ON "refresh_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "refresh_user_idx" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "groups_status_idx" ON "ride_groups" USING btree ("status","station_id");--> statement-breakpoint
CREATE INDEX "groups_driver_idx" ON "ride_groups" USING btree ("driver_id","status");--> statement-breakpoint
CREATE INDEX "rides_pool_idx" ON "ride_requests" USING btree ("status","station_id","arrival_at");--> statement-breakpoint
CREATE INDEX "rides_user_idx" ON "ride_requests" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "rides_group_idx" ON "ride_requests" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "safety_group_idx" ON "safety_events" USING btree ("group_id","created_at");--> statement-breakpoint
CREATE INDEX "safety_checkin_idx" ON "safety_events" USING btree ("check_in_deadline");--> statement-breakpoint
CREATE INDEX "sos_status_idx" ON "sos_incidents" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "stations_code_uq" ON "stations" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "shares_token_uq" ON "trip_shares" USING btree ("token");--> statement-breakpoint
CREATE INDEX "shares_ride_idx" ON "trip_shares" USING btree ("ride_id");--> statement-breakpoint
CREATE INDEX "contacts_user_idx" ON "trusted_contacts" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");