/**
 * A Painter modifies an arbitrary feature in a given Area, for instance terrain textures, elevation or calling other painters on that Area.
 * Typically the area is determined by a Placer called from createArea or createAreas.
 */

/**
 * Marks the affected area with the given tileclass.
 */
function TileClassPainter(tileClass)
{
	this.tileClass = tileClass;
}

TileClassPainter.prototype.paint = function(area)
{
	for (let point of area.points)
		this.tileClass.add(point.x, point.z);
};

/**
 * Removes the given tileclass from a given area.
 */
function TileClassUnPainter(tileClass)
{
	this.tileClass = tileClass;
}

TileClassUnPainter.prototype.paint = function(area)
{
	for (let point of area.points)
		this.tileClass.remove(point.x, point.z);
};

/**
 * The MultiPainter applies several painters to the given area.
 */
function MultiPainter(painters)
{
	this.painters = painters;
}

MultiPainter.prototype.paint = function(area)
{
	for (let painter of this.painters)
		painter.paint(area);
};

/**
 * The TerrainPainter draws a given terrain texture over the given area.
 * When used with TERRAIN_SEPARATOR, an entity is placed on each tile.
 */
function TerrainPainter(terrain)
{
	this.terrain = createTerrain(terrain);
}

TerrainPainter.prototype.paint = function(area)
{
	for (let point of area.points)
		this.terrain.place(point.x, point.z);
};

/////////////////////////////////////////////////////////////////////////////
//	LayeredPainter
//
//	Class for painting multiple layered terrains over an area
//
// 	terrainArray: Array of terrain painter objects
//	widths: Array of widths for each layer
//
/////////////////////////////////////////////////////////////////////////////

function LayeredPainter(terrainArray, widths)
{
	if (!(terrainArray instanceof Array))
		throw new Error("LayeredPainter: terrains must be an array!");

	this.terrains = [];
	for (var i = 0; i < terrainArray.length; ++i)
	{
		this.terrains.push(createTerrain(terrainArray[i]));
	}

	this.widths = widths;
}

LayeredPainter.prototype.paint = function(area)
{
	var size = getMapSize();
	var saw = [];
	var dist = [];

	// init typed arrays
	for (var i = 0; i < size; ++i)
	{
		saw[i] = new Uint8Array(size);		// bool / uint8
		dist[i] = new Uint16Array(size);	// uint16
	}

	// Point queue (implemented with array)
	var pointQ = [];

	// push edge points
	var pts = area.points;
	var length = pts.length;
	var areaID = area.getID();

	for (var i=0; i < length; i++)
	{
		var x = pts[i].x;
		var z = pts[i].z;

		for (var dx=-1; dx <= 1; dx++)
		{
			var nx = x+dx;
			for (var dz=-1; dz <= 1; dz++)
			{
				var nz = z+dz;

				if (g_Map.inMapBounds(nx, nz) && g_Map.area[nx][nz] != areaID && !saw[nx][nz])
				{
					saw[nx][nz] = 1;
					dist[nx][nz] = 0;
					pointQ.push(new PointXZ(nx, nz));
				}
			}
		}
	}

	// do BFS inwards to find distances to edge
	while (pointQ.length)
	{
		var pt = pointQ.shift();	// Pop queue
		var px = pt.x;
		var pz = pt.z;
		var d = dist[px][pz];

		// paint if in area
		if (g_Map.area[px][pz] == areaID)
		{
			var w=0;
			var i=0;

			for (; i < this.widths.length; i++)
			{
				w += this.widths[i];
				if (w >= d)
				{
					break;
				}
			}
			this.terrains[i].place(px, pz);
		}

		// enqueue neighbours
		for (var dx=-1; dx<=1; dx++)
		{
			var nx = px+dx;
			for (var dz=-1; dz<=1; dz++)
			{
				var nz = pz+dz;

				if (g_Map.inMapBounds(nx, nz) && g_Map.area[nx][nz] == areaID && !saw[nx][nz])
				{
					saw[nx][nz] = 1;
					dist[nx][nz] = d+1;
					pointQ.push(new PointXZ(nx, nz));
				}
			}
		}
	}
};

/**
 * Sets the given height in the given Area.
 */
function ElevationPainter(elevation)
{
	this.elevation = elevation;
}

ElevationPainter.prototype.paint = function(area)
{
	for (let point of area.points)
		for (let [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]])
		{
			let x = point.x + dx;
			let z = point.z + dz;

			if (g_Map.inMapBounds(x, z))
				g_Map.height[x][z] = this.elevation;
		}
};

/**
 * Absolute height change.
 */
const ELEVATION_SET = 0;

/**
 * Relative height change.
 */
const ELEVATION_MODIFY = 1;

/////////////////////////////////////////////////////////////////////////////
//	SmoothElevationPainter
//
//	Class for painting elevation smoothly over an area
//
//	type: Type of elevation modification
//			ELEVATION_MODIFY = relative
//			ELEVATION_SET = absolute
//	elevation: Target elevation/height of area
//	blendRadius: How steep the elevation change is
//
/////////////////////////////////////////////////////////////////////////////

function SmoothElevationPainter(type, elevation, blendRadius)
{
	this.type = type;
	this.elevation = elevation;
	this.blendRadius = blendRadius;

	if (type != ELEVATION_SET && type != ELEVATION_MODIFY)
		throw new Error("SmoothElevationPainter: invalid type '" + type + "'");
}

SmoothElevationPainter.prototype.checkInArea = function(areaID, x, z)
{
	// Check given tile and its neighbors
	return (
		(g_Map.inMapBounds(x, z) && g_Map.area[x][z] == areaID)
		|| (g_Map.inMapBounds(x-1, z) && g_Map.area[x-1][z] == areaID)
		|| (g_Map.inMapBounds(x, z-1) && g_Map.area[x][z-1] == areaID)
		|| (g_Map.inMapBounds(x-1, z-1) && g_Map.area[x-1][z-1] == areaID)
	);
};

SmoothElevationPainter.prototype.paint = function(area)
{
	var pointQ = [];
	var pts = area.points;
	var heightPts = [];

	var mapSize = getMapSize()+1;

	var saw = [];
	var dist = [];
	var gotHeightPt = [];
	var newHeight = [];

	// init typed arrays
	for (var i = 0; i < mapSize; ++i)
	{
		saw[i] = new Uint8Array(mapSize);			// bool / uint8
		dist[i] = new Uint16Array(mapSize);			// uint16
		gotHeightPt[i] = new Uint8Array(mapSize);	// bool / uint8
		newHeight[i] = new Float32Array(mapSize);	// float32
	}

	var length = pts.length;
	var areaID = area.getID();

	// get a list of all points
	for (var i=0; i < length; i++)
	{
		var x = pts[i].x;
		var z = pts[i].z;

		for (var dx=-1; dx <= 2; dx++)
		{
			var nx = x+dx;
			for (var dz=-1; dz <= 2; dz++)
			{
				var nz = z+dz;

				if (g_Map.validH(nx, nz) && !gotHeightPt[nx][nz])
				{
					gotHeightPt[nx][nz] = 1;
					heightPts.push(new PointXZ(nx, nz));
					newHeight[nx][nz] = g_Map.height[nx][nz];
				}
			}
		}
	}

	// push edge points
	for (var i=0; i < length; i++)
	{
		var x = pts[i].x;
		var z = pts[i].z;
		for (var dx=-1; dx <= 2; dx++)
		{
			var nx = x+dx;
			for (var dz=-1; dz <= 2; dz++)
			{
				var nz = z+dz;

				if (g_Map.validH(nx, nz) && !this.checkInArea(areaID, nx, nz) && !saw[nx][nz])
				{
					saw[nx][nz]= 1;
					dist[nx][nz] = 0;
					pointQ.push(new PointXZ(nx, nz));
				}
			}
		}
	}

	// do BFS inwards to find distances to edge
	while(pointQ.length)
	{
		var pt = pointQ.shift();
		var px = pt.x;
		var pz = pt.z;
		var d = dist[px][pz];

		// paint if in area
		if (g_Map.validH(px, pz) && this.checkInArea(areaID, px, pz))
		{
			if (d <= this.blendRadius)
			{
				var a = (d-1) / this.blendRadius;
				if (this.type == ELEVATION_SET)
				{
					newHeight[px][pz] = a*this.elevation + (1-a)*g_Map.height[px][pz];
				}
				else
				{	// type == MODIFY
					newHeight[px][pz] += a*this.elevation;
				}
			}
			else
			{	// also happens when blendRadius == 0
				if (this.type == ELEVATION_SET)
				{
					newHeight[px][pz] = this.elevation;
				}
				else
				{	// type == MODIFY
					newHeight[px][pz] += this.elevation;
				}
			}
		}

		// enqueue neighbours
		for (var dx=-1; dx <= 1; dx++)
		{
			var nx = px+dx;
			for (var dz=-1; dz <= 1; dz++)
			{
				var nz = pz+dz;

				if (g_Map.validH(nx, nz) && this.checkInArea(areaID, nx, nz) && !saw[nx][nz])
				{
					saw[nx][nz] = 1;
					dist[nx][nz] = d+1;
					pointQ.push(new PointXZ(nx, nz));
				}
			}
		}
	}

	length = heightPts.length;

	// smooth everything out
	for (var i = 0; i < length; ++i)
	{
		var pt = heightPts[i];
		var px = pt.x;
		var pz = pt.z;

		if (this.checkInArea(areaID, px, pz))
		{
			var sum = 8 * newHeight[px][pz];
			var count = 8;

			for (var dx=-1; dx <= 1; dx++)
			{
				var nx = px+dx;
				for (var dz=-1; dz <= 1; dz++)
				{
					var nz = pz+dz;

					if (g_Map.validH(nx, nz))
					{
						sum += newHeight[nx][nz];
						count++;
					}
				}
			}

			g_Map.height[px][pz] = sum/count;
		}
	}
};
