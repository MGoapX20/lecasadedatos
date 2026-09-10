import json, os
W,H,CS,ST = 96,64,0.5,2
def area(id,kind,rect,floor,wall=None,name=None):
    d={"id":id,"kind":kind,"rect":rect,"floor":floor}
    if wall is not None: d["wallHeight"]=wall
    if name: d["nameKey"]=name
    return d
areas=[
 area("plaza_s","outdoor",[0,56,96,8],"asphalt",name="area.plazaSouth"),
 area("alley_n","outdoor",[0,0,96,8],"asphalt",name="area.alleyNorth"),
 area("plaza_w","outdoor",[0,8,12,48],"asphalt",name="area.plazaWest"),
 area("plaza_e","outdoor",[84,8,12,48],"asphalt",name="area.plazaEast"),
 area("west_wing","room",[14,10,16,18],"wood",wall=4.2,name="area.westWing"),
 area("vault_hall","room",[32,10,32,18],"marble",wall=6.0,name="area.vaultHall"),
 area("dock_room","room",[66,10,16,18],"concrete",wall=4.2,name="area.dockRoom"),
 area("corridor","corridor",[14,30,68,6],"marble",wall=4.0,name="area.corridor"),
 area("staff_room","room",[14,38,16,16],"wood",wall=4.0,name="area.staffRoom"),
 area("lobby","room",[32,38,32,16],"marble",wall=6.5,name="area.lobby"),
 area("manager","room",[66,38,16,16],"wood",wall=4.0,name="area.manager"),
]
openings=[{"id":"o_lobby_w","rect":[36,36,6,2],"kind":"arch"},
          {"id":"o_lobby_e","rect":[54,36,6,2],"kind":"arch"}]
doors=[
 {"id":"d_front","pick":{"pins":2,"zone":0.30,"speed":0.85},"rect":[44,54,8,2],"kind":"door","locked":False,"lockpickQuanta":16,"lockableByChief":True,"swing":"x","nameKey":"door.front","analogyKey":"analogy.front"},
 {"id":"d_side","pick":{"pins":3,"zone":0.22,"speed":1.10},"rect":[82,32,2,4],"kind":"door","locked":True,"lockpickQuanta":12,"lockableByChief":True,"swing":"z","nameKey":"door.side","analogyKey":"analogy.side"},
 {"id":"d_dock_outer","pick":{"pins":2,"zone":0.28,"speed":0.95},"rect":[70,8,6,2],"kind":"gate","locked":False,"lockpickQuanta":14,"lockableByChief":True,"swing":"x","nameKey":"door.dockOuter","analogyKey":"analogy.dock"},
 {"id":"d_west","pick":{"pins":2,"zone":0.30,"speed":0.85},"rect":[20,28,4,2],"kind":"door","locked":False,"lockpickQuanta":14,"lockableByChief":True,"swing":"x","nameKey":"door.west"},
 {"id":"d_staff","pick":{"pins":2,"zone":0.30,"speed":0.85},"rect":[20,36,4,2],"kind":"door","locked":False,"lockpickQuanta":14,"lockableByChief":True,"swing":"x","nameKey":"door.staff"},
 {"id":"d_dock_in","pick":{"pins":3,"zone":0.22,"speed":1.15},"rect":[70,28,4,2],"kind":"door","locked":True,"lockpickQuanta":14,"lockableByChief":True,"swing":"x","nameKey":"door.dockInner"},
 {"id":"d_manager","pick":{"pins":3,"zone":0.20,"speed":1.20},"rect":[70,36,4,2],"kind":"door","locked":True,"lockpickQuanta":10,"lockableByChief":True,"swing":"x","nameKey":"door.manager"},
 {"id":"d_vault","pick":{"pins":3,"zone":0.18,"speed":1.30},"rect":[44,28,8,2],"kind":"vault","locked":True,"keyId":"k_manager","lockpickQuanta":14,"lockableByChief":True,"swing":"x","nameKey":"door.vault","analogyKey":"analogy.vaultDoor"},
]
portals=[{"id":"p_vent","from":[6,16],"to":[22,14],"traverseQuanta":20,"kind":"vent"},
         {"id":"p_sewer","from":[8,60],"to":[18,50],"traverseQuanta":24,"kind":"sewer"}]
entries=[
 {"id":"front","spawn":[48,61],"cell":[48,52],"kind":"door","doorId":"d_front","nameKey":"entry.front","analogyKey":"analogy.front"},
 {"id":"side","spawn":[91,34],"cell":[80,33],"kind":"door","doorId":"d_side","nameKey":"entry.side","analogyKey":"analogy.side"},
 {"id":"dock","spawn":[73,3],"cell":[73,12],"kind":"gate","doorId":"d_dock_outer","nameKey":"entry.dock","analogyKey":"analogy.dock"},
 {"id":"vent","spawn":[6,16],"cell":[22,14],"kind":"vent","nameKey":"entry.vent","analogyKey":"analogy.vent"},
 {"id":"sewer","spawn":[8,60],"cell":[18,50],"kind":"hatch","nameKey":"entry.sewer","analogyKey":"analogy.sewer"},
]
keycards=[{"id":"k_manager","cell":[77,41],"nameKey":"key.manager"}]
guards=[
 {"id":"g1","nameKey":"guard.corridor","vision":{"fovDeg":95,"range":8.0},
  "patrol":{"loop":True,"waypoints":[{"cell":[18,33],"holdTicks":26},{"cell":[40,33]},{"cell":[70,33],"holdTicks":22},{"cell":[40,33]}]}},
 {"id":"g2","nameKey":"guard.lobby","vision":{"fovDeg":95,"range":8.5},
  "patrol":{"loop":True,"waypoints":[{"cell":[36,50],"holdTicks":20},{"cell":[60,50]},{"cell":[60,40],"holdTicks":20},{"cell":[36,40]}]}},
 {"id":"g3","nameKey":"guard.vault","vision":{"fovDeg":80,"range":7.0},
  "patrol":{"loop":True,"waypoints":[{"cell":[44,22],"holdTicks":18},{"cell":[54,22],"holdTicks":18},{"cell":[54,16]},{"cell":[44,16]}]}},
 {"id":"g4","nameKey":"guard.rover","vision":{"fovDeg":95,"range":7.0},
  "patrol":{"loop":True,"waypoints":[{"cell":[73,14],"holdTicks":30},{"cell":[73,33]},{"cell":[62,33],"holdTicks":24},{"cell":[73,33]}]}},
]
cameras=[
 {"id":"c1","cell":[34,11],"height":4.2,"facingDeg":40,"fovDeg":52,"range":10.0,"sweep":{"amplitudeDeg":55,"periodTicks":200}},
 {"id":"c2","cell":[33,53],"height":4.4,"facingDeg":20,"fovDeg":50,"range":9.0,"sweep":{"amplitudeDeg":55,"periodTicks":180}},
 {"id":"c3","cell":[74,24],"height":3.4,"facingDeg":270,"fovDeg":55,"range":8.0,"sweep":{"amplitudeDeg":45,"periodTicks":280}},
]
props=[]
def P(kind,x,y,rot=0,scale=1.0,solid=False,radius=None):
    d={"kind":kind,"cell":[x,y]}
    if rot: d["rotDeg"]=rot
    if scale!=1.0: d["scale"]=scale
    if solid: d["solid"]=True
    if radius is not None: d["radius"]=radius
    props.append(d)
for x in [18,26,34,58,66,74]:
    P("column",x,58,solid=True,radius=0.8); P("lamp",x,61)
P("banner",30,57); P("banner",62,57)
P("statue",40,60,solid=True,radius=0.7); P("statue",56,60,solid=True,radius=0.7)
for x in [36,48,60]: P("teller",x,45,solid=True,radius=1.5)
# corridor colonnade: neoclassical, and it casts the shadows a planner can use
for x in [28,40,56,64,78]: P("column",x,31,solid=True,radius=0.7)
for x,y in [(34,40),(62,40),(34,52),(62,52)]: P("plant",x,y,solid=True,radius=0.6)
P("chandelier",48,46)
for x in [40,52]: P("bench",x,52,solid=True,radius=1.0)
for x,y in [(37,14),(59,14),(37,24),(59,24)]: P("press",x,y,solid=True,radius=2.0)
for x,y in [(43,13),(53,13),(43,25),(53,25)]: P("moneyStack",x,y,solid=True,radius=0.8)
P("chandelier",48,18)
for x,y in [(17,13),(27,13),(17,25),(27,25)]: P("cabinet",x,y,solid=True,radius=1.0)
P("desk",18,41,solid=True,radius=1.5); P("desk",27,41,solid=True,radius=1.5)
P("sofa",26,50,solid=True,radius=1.2); P("plant",17,52,solid=True,radius=0.6)
P("desk",74,45,solid=True,radius=1.5); P("cabinet",80,41,solid=True,radius=1.0)
P("plant",79,51,solid=True,radius=0.6)
for x,y in [(69,15),(69,19),(78,15),(78,23)]: P("crate",x,y,solid=True,radius=1.1)
P("truck",58,4,rot=90,solid=True,radius=3.0)
for x in [20,40,84]: P("lamp",x,4)
rules={"tickHz":20,"quantumTicks":5,"horizonSec":75,"aiCellsPerQuantum":1,"humanQuantaPerCell":2,
 "playerSpeed":3.8,"guardSpeed":2.2,"chaseSpeed":3.4,"vaultPrintQuanta":8,"defaultLockpickQuanta":24,
 "maxLocks":3,"alarmBoostSec":8,"alarmCooldownSec":20,"alarmVisionMul":1.5}
level={"id":"mint_v1","grid":{"w":W,"h":H,"cellSize":CS,"planStride":ST},"rules":rules,
 "areas":areas,"openings":openings,"doors":doors,"portals":portals,"entries":entries,
 "keycards":keycards,"guards":guards,"cameras":cameras,"props":props,
 "vault":{"cell":[48,18],"rect":[40,12,16,12],"nameKey":"vault","analogyKey":"analogy.vault"},
 "keycardSpots":[[77,41],[68,42],[22,47],[21,19],[74,20],[26,21]],
 "safeSpots":[[48,60],[91,34],[73,3],[6,16],[8,60],[18,50],[75,40],[22,14],[48,50]],
 "shiftChange":{"startTick":900,"durationTicks":320,"guardsAffected":["g4"],"analogyKey":"analogy.shift"}}
with open("public/levels/mint_v1.json","w") as f: json.dump(level,f,indent=1)
print("ok")
