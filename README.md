# data-cube-x
Hackable 3D image (volumetric image) library for the web. It is the 
rendering engine used for the electron microscopy view of eyewire.org. 

The `DataCube` library provides facilities for representing 3D images
as a one dimensional array and rendering axial slices to a canvas. 

Unlike other libraries, this is handled using pure Javascript and DOM
manipulations, no WebGL programming required. `DataCube` provides a useful 
abstraction for writing arbitrary images into a stack, is lightweight, and 
is easy to remix into many different web applications as an independent 
building block. 

The library also provides a `Volume` object that can render a pixel labeling 
on top of a 3D image, for example, a segmentation on top of a microscope channel.

Check out the demo: https://seung-lab.github.io/data-cube-x/ 

The Eyewire variant of `DataCube` has been shown to render 1024x1024 axial
slices of a 1024x1024x128 volume at 55 FPS while computing an overlay. WebGL
can go faster than that, but for many applications, that should be more than
sufficient. This version doesn't use all the same tricks, but if you run into
a performance limitation, let us know.

# Setup

Requires jQuery to use `Volume` but not base `DataCube`.

```
<script src="path/to/datacube.js"></script>
```

# Running the Demo Locally

Run a python static file server like so from the data-cube-x top-level directory:

`python3 -m http.server 8000`

Then access the application from:

http://localhost:8000/index.html

The example data is taken from mouse somatosensory cortex (S1) and a prototype reconstruction.

```
Kasthuri et al. "Saturated Reconstruction of a Volume of Neocortex." Cell 2015.
DOI: 10.1016/j.cell.2015.06.054

Cutout parameters (voxels xyz): 8319:8319+256, 6189:6189+256, 449:449+256
```

# Example Usage

The datacube consists of two objects, Datacube, useful for representing 3D images, and `Volume`, used for rendering a segmentation overlaying a channel using two `DataCube`s.

## DataCube

DataCube is a 1D array representing a 3D image in row-major (XYZ) order.

### Attributes

Attribute|Type|Meaning
:-----:|:-----:|:-----:
bytes|Number|1 = uint8; 2 = uint16; 4 = uint32
size| { x: ..., y: ..., z: ... }|Dimensions in voxels
cube|TypedArray|Underlying array access.
canvas\_context|context|Internal use only.
clean|boolean|true when no data has been written to this instance.
loaded|boolean|Semi-Manually controlled. Set to false on clear.
faces|dict|Internal use only.

### Methods

Method|Usage
:-----:|:-----:
clear()|Blank array, this.clean=true, this.loaded=false
get(x, y, z)|Return a single voxel value.
insertImage(img, offsetx=0, offsety=0, offsetz=0)|Write XY oriented Image into cube at offset
insertCanvas(canvas, offsetx=0, offsety=0, offsetz=0)|Write XY oriented Canvas into cube at offset
insertSquare(square, width, offsetx=0, offsety=0, offsetz=0)|Write an XY oriented plane into the cube as from a 1D array representation.
slice (axis, index, copy = true)|Return a 2D slice of the data cube as a 1D array in XYZ order.
renderGrayImageSlice(context, axis, index)|Render a grayscale 2D axial slice to a canvas context.
renderImageSlice(context, axis, index)|Render a color 2D axial slice to a canvas context.


### Examples

```
var dc = new DataCube({
	bytes: 1, // 8-bit gray data for an EM image, 16-bit is 2, etc
	size: { x: 256, y: 256, z: 256 }, // dimensions in voxels
});

// Insert some data using a 256x256 XY plane image "img" with
// no offset from the origin.
dc.insertImage(img, /*offsetx=*/0, /*offsety=*/0, /*offsetz=*/0);

// You can also insert a similar canvas object, say at z=5
dc.insertCanvas(canvas, /*offsetx=*/0, /*offsety=*/0, /*offsetz=*/5);

// Once you've loaded your cube, you can slice it.
// Here we get a row-major 1d array representing a 2D plane
// cut from the XY plane at Z = 6 (with 0 indexing)
var plane = dc.slice('z', 6); 

// By default, plane is a copy, but if you need additional 
// performance, you can return a view of the data cube
var plane = dc.slice('z', 6, /*copy=*/false);

// You can also render directly to a canvas
// This method specializes in rendering 
// 8-bit gray scale data
var ctx = canvas.getContext('2d');
dc.renderGrayImageSlice (ctx, 'x', 3); // YZ plane, slice 3

// For segmentation, you can render in color
var ctx = canvas.getContext('2d');
dc.renderImageSlice(ctx, 'y', 8); // XZ plane, slice 8
```

## Volume

`Volume` is currently provided in the library as a guide for hacking with `DataCube`. To use it for youself, you'll need to manipulate `generateUrls` and `loadVolume`.

```
var vol = new Volume({ 
	channel: new DataCube({ bytes: 1, size: [ 256, 256, 256 ] }), 
	segmentation: new DataCube({ bytes: 2, size: [ 256, 256, 256 ] }), 
});

// channelctx and segctx below represent 
// canvas contexts for channel and segmentation

// Direct cube access version (zero renders as black)

vol.load().done(function () {
	vol.channel.renderGrayImageSlice(channelctx, 'x', 0); // these should be synchronized
	vol.segmentation.renderImageSlice(segctx, 'x', 0); 
})

// Checkerboard version (zero renders as checkerboard pattern)

vol.load().done(function () {
	vol.renderChannelImage(channelctx, 'x', 0); // these should be synchronized
	vol.renderSegmentationImage(segctx, 'x', 0); 
})
```

You can also access the cube data as squares -- planes that cut through the cube on an axis:

```
vol.channel.slice('x', 52) => 1D array of 8 bit values, arranged as x,y,z
vol.segmentation.slice('z', 156) => 1D array of 16 bit values, arranged as x,y,z
```
You can grab single values:

```
vol.channel.get(35, 12, 0) => Single integer value at x=35, y=12, z=0
```

...or if you really need to, you can access the cube directly:

```
vol.channel.cube => 1D array representing the whole 3D cube
```

vol.size.x, vol.size.y, vol.size.z gives you the parameters neceessary to work with that


