-- AlterTable
ALTER TABLE "Branch" ADD COLUMN     "geofenceLat" DOUBLE PRECISION,
ADD COLUMN     "geofenceLng" DOUBLE PRECISION,
ADD COLUMN     "geofenceRadiusMeters" INTEGER;
