.pragma library

// Drone type constants
var DroneType = {
    DJI_MINI_4_PRO: "DJI_MINI_4_PRO",
    DJI_AIR_3: "DJI_AIR_3",
    DJI_MINI_5_PRO: "DJI_MINI_5_PRO",
    POTENSIC_ATOM_1: "POTENSIC_ATOM_1",
    POTENSIC_ATOM_2: "POTENSIC_ATOM_2"
};

// Flight mode constants
var FlightMode = {
    WAYLINES: "waylines",
    WAYPOINTS: "waypoints"
};

// Gimbal angle presets
var GimbalAngle = {
    OFF_NADIR: "-80",
    OBLIQUE: "-45",
    NADIR: "-90"
};

// Drone sensor specifications
// Battery life calculated using constant average speed of 11.5 m/s
var DRONE_SPECS = {
    DJI_MINI_4_PRO: {
        max_battery_life_minutes: { quoted_value: 34, tested_value: 21.6 },
        sensor_height_mm: 7.2,
        sensor_width_mm: 9.6,
        equiv_focal_length_mm: 24,
        image_width_px: 4032
    },
    DJI_AIR_3: {
        max_battery_life_minutes: { quoted_value: 46, tested_value: 28.8 },
        sensor_height_mm: 7.2,
        sensor_width_mm: 9.6,
        equiv_focal_length_mm: 24,
        image_width_px: 4032
    },
    DJI_MINI_5_PRO: {
        max_battery_life_minutes: { quoted_value: 36, tested_value: 21.6 },
        sensor_height_mm: 9.6,
        sensor_width_mm: 12.8,
        equiv_focal_length_mm: 24,
        image_width_px: 4032
    },
    POTENSIC_ATOM_1: {
        max_battery_life_minutes: { quoted_value: 32, tested_value: 18 },
        sensor_height_mm: 4.80,
        sensor_width_mm: 6.40,
        equiv_focal_length_mm: 26,
        image_width_px: 4608
    },
    POTENSIC_ATOM_2: {
        max_battery_life_minutes: { quoted_value: 32, tested_value: 25 },
        sensor_height_mm: 4.80,
        sensor_width_mm: 6.40,
        equiv_focal_length_mm: 26,
        image_width_px: 4608
    }
};

// Pre-calculated drone parameters (FOV in radians, GSD-to-AGL conversion constant)
// See drone_type.py comments for calculation methodology
var DRONE_PARAMS = {
    DJI_MINI_4_PRO: {
        VERTICAL_FOV: 0.99,
        HORIZONTAL_FOV: 1.25,
        GSD_TO_AGL_CONST: 27.95,
        OUTPUT_FORMAT: "DJI_WPML"
    },
    DJI_AIR_3: {
        VERTICAL_FOV: 0.99,
        HORIZONTAL_FOV: 1.25,
        GSD_TO_AGL_CONST: 27.95,
        OUTPUT_FORMAT: "DJI_WPML"
    },
    DJI_MINI_5_PRO: {
        VERTICAL_FOV: 0.99,
        HORIZONTAL_FOV: 1.25,
        GSD_TO_AGL_CONST: 27.95,
        OUTPUT_FORMAT: "DJI_WPML"
    },
    POTENSIC_ATOM_1: {
        VERTICAL_FOV: 0.93,
        HORIZONTAL_FOV: 1.17,
        GSD_TO_AGL_CONST: 34.61,
        OUTPUT_FORMAT: "POTENSIC_SQLITE"
    },
    POTENSIC_ATOM_2: {
        VERTICAL_FOV: 0.93,
        HORIZONTAL_FOV: 1.17,
        GSD_TO_AGL_CONST: 34.61,
        OUTPUT_FORMAT: "POTENSIC_JSON"
    }
};

// Human-readable drone names for UI display
var DRONE_DISPLAY_NAMES = {
    DJI_MINI_4_PRO: "DJI Mini 4 Pro",
    DJI_AIR_3: "DJI Air 3",
    DJI_MINI_5_PRO: "DJI Mini 5 Pro",
    POTENSIC_ATOM_1: "Potensic Atom 1",
    POTENSIC_ATOM_2: "Potensic Atom 2"
};
