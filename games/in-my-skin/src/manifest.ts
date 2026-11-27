/** The SDK manifest for In My Skin (spec 2026-11-23-in-my-skin-design.md). */
import type { GameManifest } from "@emb/game-sdk";

export const manifest: GameManifest = {
  "id": "in-my-skin",
  "name": {
    "en": "In My Skin",
    "he": "בתוך העור שלי"
  },
  "summary": {
    "en": "A picture moves toward its grey copy. Press Stop when it is right on top of it.",
    "he": "תמונה נעה אל העותק האפור שלה. לוחצים על עצור כשהיא בדיוק מעליו."
  },
  "credits": {
    "en": "Pictures: Fluent Emoji (Microsoft Corporation), MIT licence",
    "he": "תמונות: Fluent Emoji (Microsoft Corporation), רישיון MIT"
  },
  "version": "1.0.0",
  "sdkVersion": "^2.0.0",
  "entry": "index.js",
  "renderer": "pixi",
  "orientation": [
    "landscape",
    "portrait"
  ],
  "inputs": [
    "touch",
    "mouse",
    "keyboard"
  ],
  "maxLevel": 30,
  "ageRange": [
    4,
    16
  ],
  "minutes": 5,
  "capabilities": {
    "modes": [
      "timed",
      "lives",
      "timed_lives"
    ],
    "livesAuto": false,
    "trialWindow": false,
    "practice": true,
    "rng": "seeded",
    "monochrome": false
  },
  "hemisphereNote": {
    "left": {
      "en": "Warm colours. Letters, numbers, cartoons and everyday items. Stop button at the bottom right.",
      "he": "צבעים חמים. אותיות, מספרים, דמויות מצוירות וחפצים יומיומיים. כפתור העצירה למטה מימין."
    },
    "right": {
      "en": "Cool colours. 3D objects, shapes, sports equipment, road signs and arrows. Stop button at the bottom left.",
      "he": "צבעים קרים. עצמים תלת-ממדיים, צורות, ציוד ספורט, תמרורים וחצים. כפתור העצירה למטה משמאל."
    }
  },
  "regionUse": {
    "background": {
      "temperature": "bg_temperature",
      "type": "background"
    },
    "direction": true,
    "targetLocation": true,
    "movement": true
  },
  "recommendedMode": "timed_lives",
  "recommendedDurationS": 300,
  "lifeLossEvents": [
    {
      "id": "stopped_early",
      "label": {
        "en": "Stopped too early",
        "he": "עצר מוקדם מדי"
      }
    },
    {
      "id": "stopped_late",
      "label": {
        "en": "Stopped too late",
        "he": "עצר מאוחר מדי"
      }
    },
    {
      "id": "no_stop",
      "label": {
        "en": "Did not stop",
        "he": "לא עצר"
      }
    }
  ],
  "qualifyingInteraction": "The Tap to start button",
  "paramsSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "category": {
        "type": "string",
        "enum": [
          "auto",
          "flat_objects",
          "objects_3d",
          "cartoon_faces",
          "letters",
          "numbers",
          "operations",
          "shapes",
          "cartoons",
          "sports",
          "road_signs",
          "arrows",
          "everyday"
        ],
        "default": "auto",
        "x-ui": {
          "label": {
            "en": "Pictures",
            "he": "תמונות"
          },
          "help": {
            "en": "Automatic = the picture kinds that go with the hemisphere.",
            "he": "אוטומטי = סוגי התמונות שמתאימים להמיספרה."
          },
          "widget": "select",
          "options": {
            "auto": {
              "en": "Automatic (by hemisphere)",
              "he": "אוטומטי (לפי ההמיספרה)"
            },
            "flat_objects": {
              "en": "2D objects",
              "he": "עצמים דו-ממדיים"
            },
            "objects_3d": {
              "en": "3D objects",
              "he": "עצמים תלת-ממדיים"
            },
            "cartoon_faces": {
              "en": "Cartoon faces",
              "he": "פרצופים מצוירים"
            },
            "letters": {
              "en": "Letters",
              "he": "אותיות"
            },
            "numbers": {
              "en": "Numbers",
              "he": "מספרים"
            },
            "operations": {
              "en": "Arithmetic signs",
              "he": "סימני חשבון"
            },
            "shapes": {
              "en": "Geometric shapes",
              "he": "צורות גאומטריות"
            },
            "cartoons": {
              "en": "Cartoons",
              "he": "דמויות מצוירות"
            },
            "sports": {
              "en": "Sports equipment",
              "he": "ציוד ספורט"
            },
            "road_signs": {
              "en": "Road signs",
              "he": "תמרורים"
            },
            "arrows": {
              "en": "Arrows",
              "he": "חצים"
            },
            "everyday": {
              "en": "Everyday items",
              "he": "חפצים יומיומיים"
            }
          }
        }
      },
      "movement_type": {
        "type": "string",
        "enum": [
          "auto",
          "continuous",
          "intervals",
          "continuous-intervals",
          "intervals-continuous"
        ],
        "default": "auto",
        "x-ui": {
          "label": {
            "en": "Movement",
            "he": "תנועה"
          },
          "help": {
            "en": "Automatic = from the brain region. Intervals: the picture jumps from spot to spot. \"Back\" = it returns the opposite way.",
            "he": "אוטומטי = לפי אזור המוח. בקפיצות: התמונה קופצת מנקודה לנקודה. ״חזרה״ = היא חוזרת בכיוון ההפוך."
          },
          "widget": "select",
          "options": {
            "auto": {
              "en": "Automatic",
              "he": "אוטומטי"
            },
            "continuous": {
              "en": "Continuous",
              "he": "רציפה"
            },
            "intervals": {
              "en": "Intervals",
              "he": "בקפיצות"
            },
            "continuous-intervals": {
              "en": "Continuous, back in intervals",
              "he": "רציפה, חזרה בקפיצות"
            },
            "intervals-continuous": {
              "en": "Intervals, back continuous",
              "he": "בקפיצות, חזרה רציפה"
            }
          }
        }
      },
      "bg_temperature": {
        "type": "string",
        "enum": [
          "auto",
          "warm",
          "cold"
        ],
        "default": "auto",
        "x-ui": {
          "label": {
            "en": "Background colours",
            "he": "צבעי הרקע"
          },
          "widget": "segmented",
          "options": {
            "auto": {
              "en": "By side",
              "he": "לפי הצד"
            },
            "warm": {
              "en": "Warm",
              "he": "חמים"
            },
            "cold": {
              "en": "Cool",
              "he": "קרים"
            }
          }
        }
      },
      "background": {
        "type": "string",
        "enum": [
          "solid",
          "textured"
        ],
        "default": "solid",
        "x-ui": {
          "label": {
            "en": "Background",
            "he": "רקע"
          },
          "widget": "segmented",
          "options": {
            "solid": {
              "en": "Plain",
              "he": "אחיד"
            },
            "textured": {
              "en": "Patterned",
              "he": "עם דוגמה"
            }
          }
        }
      },
      "direction": {
        "type": "string",
        "enum": [
          "auto"
        ],
        "default": "auto",
        "x-ui": {
          "label": {
            "en": "Direction of movement",
            "he": "כיוון התנועה"
          },
          "widget": "select",
          "options": {
            "auto": {
              "en": "Automatic",
              "he": "אוטומטי"
            }
          }
        }
      }
    }
  },
  "metrics": [
    {
      "key": "accuracy",
      "label": {
        "en": "Stopped on time",
        "he": "עצירות בזמן"
      },
      "unit": "ratio",
      "lowerIsBetter": false,
      "skills": [
        "anticipation_timing"
      ]
    },
    {
      "key": "early_rate",
      "label": {
        "en": "Stopped too early",
        "he": "עצירות מוקדמות מדי"
      },
      "unit": "ratio",
      "lowerIsBetter": true,
      "skills": [
        "inhibition"
      ]
    },
    {
      "key": "late_rate",
      "label": {
        "en": "Stopped too late",
        "he": "עצירות מאוחרות מדי"
      },
      "unit": "ratio",
      "lowerIsBetter": true,
      "skills": [
        "anticipation_timing"
      ]
    },
    {
      "key": "no_stop_rate",
      "label": {
        "en": "Did not stop",
        "he": "בלי עצירה"
      },
      "unit": "ratio",
      "lowerIsBetter": true,
      "skills": [
        "sustained_attention"
      ]
    },
    {
      "key": "timing_error_ms",
      "label": {
        "en": "Timing error",
        "he": "סטייה בתזמון"
      },
      "unit": "ms",
      "lowerIsBetter": true,
      "skills": [
        "anticipation_timing"
      ]
    },
    {
      "key": "timing_bias_ms",
      "label": {
        "en": "Early (−) or late (+) on average",
        "he": "מוקדם (−) או מאוחר (+) בממוצע"
      },
      "unit": "ms",
      "lowerIsBetter": true,
      "skills": [
        "anticipation_timing"
      ]
    },
    {
      "key": "timing_spread_ms",
      "label": {
        "en": "Timing consistency",
        "he": "עקביות התזמון"
      },
      "unit": "ms",
      "lowerIsBetter": true,
      "skills": [
        "anticipation_timing"
      ]
    },
    {
      "key": "coverage_mean",
      "label": {
        "en": "Outline covered at the stop",
        "he": "כיסוי קו המתאר בעצירה"
      },
      "unit": "ratio",
      "lowerIsBetter": false,
      "skills": [
        "visual_tracking"
      ]
    },
    {
      "key": "first_leg_rate",
      "label": {
        "en": "On time at the first pass",
        "he": "בזמן כבר במעבר הראשון"
      },
      "unit": "ratio",
      "lowerIsBetter": false,
      "skills": [
        "visual_tracking"
      ]
    },
    {
      "key": "glide_accuracy",
      "label": {
        "en": "On time, continuous movement",
        "he": "בזמן, תנועה רציפה"
      },
      "unit": "ratio",
      "lowerIsBetter": false,
      "skills": [
        "visual_tracking"
      ]
    },
    {
      "key": "jump_accuracy",
      "label": {
        "en": "On time, movement in intervals",
        "he": "בזמן, תנועה בקפיצות"
      },
      "unit": "ratio",
      "lowerIsBetter": false,
      "skills": [
        "visual_tracking"
      ]
    },
    {
      "key": "stray_taps",
      "label": {
        "en": "Taps beside the button",
        "he": "הקשות ליד הכפתור"
      },
      "unit": "count",
      "lowerIsBetter": true
    },
    {
      "key": "best_streak",
      "label": {
        "en": "Best streak",
        "he": "רצף הצלחות"
      },
      "unit": "count",
      "lowerIsBetter": false
    },
    {
      "key": "highest_level",
      "label": {
        "en": "Highest level",
        "he": "השלב הגבוה ביותר"
      },
      "unit": "count",
      "lowerIsBetter": false
    }
  ],
  "assetPacks": {
    "warm": "packs/warm/pack.json",
    "cold": "packs/cold/pack.json",
    "shared": "packs/shared/pack.json"
  },
  "taxonomy": {
    "skills": [
      "anticipation_timing",
      "visual_tracking",
      "inhibition",
      "sustained_attention"
    ],
    "regions": []
  },
  "sizeBytes": {
    "core": 0,
    "warm": 0,
    "cold": 0
  }
};
