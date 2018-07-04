let _loadingimg = new Image();
_loadingimg.src = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAIAAABMXPacAAAAGXRFWHRTb2Z0d2FyZQBBZG9iZSBJbWFnZVJlYWR5ccllPAAAATpJREFUeNrs18ENgCAQAEE09iJl0H8F2o0N+DTZh7NPcr/JEdjWWuOtc87X8/u6zH84vw+lAQAAQAAACMA/O7zH23kb4AoCIAAABACAin+A93g7bwNcQQAEAIAAAFDxD/Aeb+dtgCsIgAAAEAAAKv4B3uPtvA1wBQEQAAACAEDFP8B7vJ23Aa4gAAIAQAAAqPgHeI+38zbAFQRAAAAIAAAV/wDv8XbeBriCAAgAAAEAoOIf4D3eztsAVxAAAQAgAABU/AO8x9t5G+AKAiAAAAQAgIp/gPd4O28DXEEABACAAABQ8Q/wHm/nbYArCIAAABAAACr+Ad7j7bwNcAUBEAAAAgBAxT/Ae7ydtwGuIAACAEAAAKj4B3iPt/M2wBUEQAAACAAAFf8A7/F23ga4ggAIAAABAKCgR4ABAIa/f2QspBp6AAAAAElFTkSuQmCC";

/* Volume
 *
 * Represents a 3D bounding box in the data set's global coordinate space.
 * Contains two types of images: channel (raw EM images), 
 * and segmentation (AI determined supervoxels)
 *
 * Required:
 *   channel: A blankable Datacube representing the channel values. 
 *        Since they're grayscale, an efficient representation is 1 byte
 *   segmentation: A blankable Datacube representing segmentation values.
 * 		  Seg ids don't appear to rise above the high thousands, so 2 bytes is probably sufficent.
 *
 * Return: Volume object
 */
class Volume {
	constructor (args) {
		this.channel = args.channel; // a data cube
		this.segmentation = args.segmentation; // a segmentation cube

		this.segments = {};
		this.requests = [];
	}

	/* load
	 *
	 * Download the channel and segmentation and materialize them into
	 * their respective datacubes.
	 *
	 * Return: promise representing download completion state
	 */
	load () {
		let _this = this;

		if (!this.channel.clean) {
			this.channel.clear();
		}

		if (!this.segmentation.clean) {
			this.segmentation.clear();
		}

		this.requests = [];

		let deferred = $.Deferred();

		let channel_promise = _this.loadVolume('images/channel', _this.channel);
		let seg_promise = _this.loadVolume('images/segmentation', _this.segmentation);

		$.when(channel_promise, seg_promise)
			.done(function () {
				deferred.resolve();
			})
			.fail(function () {
				deferred.reject();
			})
			.always(function () {
				_this.requests = [];
			});

		return deferred;
	}

	/* loadingProgress
	 *
	 * How far along the download are we?
	 *
	 * Return: float [0, 1]
	 */
	loadingProgress () {
		if (this.segmentation.loaded && this.channel.loaded) {
			return 1;
		}
		else if (this.segmentation.clean && this.channel.clean) {
			return 0;
		}
		else if (this.requests.length === 0) {
			return 0;
		}

		let specs = this.generateUrls();

		let resolved = this.requests.filter(req => req.state() !== 'pending');
		return resolved.length / (2 * specs.length);
	}

	/* abort
	 *
	 * Terminate in progress downloads.
	 *
	 * Return: void
	 */
	abort () {
		this.requests.forEach(function (jqxhr) {
			jqxhr.abort();
		});
	}

	/* loadVolume
	 *
	 * Download and materialize a particular Volume ID into a Datacube
	 * via the XY plane / Z-axis.
	 *
	 * Required:
	 *   [0] vid: (int) Volume ID 
	 *   [1] cube: The datacube to use
	 *
	 * Return: promise representing loading completion
	 */
	loadVolume (dir, cube) {
		let _this = this;

		let specs = this.generateUrls(dir);

		// _this.requests = [];

		function load_spec (spec, retries) {
			if (retries > 2) {
				throw new Error("Too many retries");
			}

			let img = new Image(spec.width, spec.height);
			img.src = spec.url;
			
			let req = $.Deferred();

			img.onload = function () {
    			cube.insertImage(img, spec.x, spec.y, spec.z);
    			req.resolve();
  			};
  			img.onerror = function () {
  				req.reject();
  				setTimeout(function () {
  					load_spec(spec, retries + 1)
  				}, 1000)
  			};

			_this.requests.push(req);
		}

		specs.forEach((spec) => load_spec(spec, 0))

		return $.when.apply($, _this.requests).done(function () {
			cube.loaded = true;
		});
	}

	/* generateUrls
	 *
	 * Generate a set of url specifications required to download a whole 
	 * volume in addition to the offsets since they're downloading.
	 *
	 * Cubes 256x256x256 voxels and are downloaded as slices.
	 *
	 * Return: [
	 *    {
	 *      url: self explainatory,
	 *      x: offset from 0,0,0 in data cube
	 *      y: offset from 0,0,0 in data cube
	 *      z: offset from 0,0,0 in data cube
	 *      width: horizontal dimension of image requested on XY plane
	 *      height: vertical dimension of image requested on XY plane
	 *      depth: bundle size, won't necessarily match height or width
	 *    },
	 *    ...
	 * ]
	 */
	generateUrls (dir) {
		let _this = this;

		let specs = [];
		for (let z = 0; z < 256; z++) {
			let zstr = z < 10 ? '0' + z : z;

			specs.push({
				url: `/${dir}/${zstr}.png`,
				x: 0,
				y: 0,
				z: z,
				width: 256,
				height: 256,
				depth: 1,
			});
		}

		return specs;
	}

	/* renderChannelSlice
	 *
	 * Render the channel image to the given canvas context.
	 * Advantage over direct data cube access is the use of a
	 * background loading image.
	 *
	 * Required:
	 *   [0] ctx
	 *   [1] axis: 'x', 'y', or 'z'
	 *   [2] slice: 0 - 255
	 *
	 * Return: segid, w/ side effect of drawing on ctx
	 */
	renderChannelSlice (ctx, axis, slice) {
		let _this = this;

		ctx.drawImage(_loadingimg, 0, 0);
		ctx.drawImage(_loadingimg, 128, 0);
		ctx.drawImage(_loadingimg, 0, 128);
		ctx.drawImage(_loadingimg, 128, 128);

		let loading = ctx.getImageData(0, 0, 256, 256);
		let loading32 = new Uint32Array(loading.data.buffer);

		let pixels = _this.channel.grayImageSlice(axis, slice);
		let slice32 = new Uint32Array(pixels.data.buffer); // creates a view, not an array

		let segmentation = _this.segmentation.slice(axis, slice, /*copy=*/false);

		let x, y, segid;

		const color = [ 0, 0, 255 ];
		const alpha = 0.25;

		// exploting the fact that we know that there are 
		// no black pixels in our channel images and that they're gray
		for (let i = slice32.length - 1; i >= 0; i--) {
			segid = segmentation[i];

			// 00ffff00 b/c green and blue can be swapped on big/little endian
			// but it doesn't matter like red and alpha. Just need to test for non
			// black pixels. The logical ands and ors are to avoid a branch.
			slice32[i] = ((slice32[i] & 0x00ffff00) && slice32[i]) || loading32[i];

			// overlayColor[i] + buffer[startIndex + i] * (1 - alpha);
			if (_this.segments[segid]) {
				pixels.data[i * 4 + 0] = ((pixels.data[i * 4 + 0] * (1 - alpha)) + (color[0] * alpha)) | 0;
				pixels.data[i * 4 + 1] = ((pixels.data[i * 4 + 1] * (1 - alpha)) + (color[1] * alpha)) | 0;
				pixels.data[i * 4 + 2] = ((pixels.data[i * 4 + 2] * (1 - alpha)) + (color[2] * alpha)) | 0;
			}
		}

		ctx.putImageData(pixels, 0, 0);

		return this;
	}

	/* renderSegmentationSlice
	 *
	 * Convenience method for rendering a segmentation image.
	 * This is mostly used for testing, and this method mainly exists
	 * for consistency of API.
	 *
	 * Required:
	 *   [0] ctx
	 *   [1] axis: 'x', 'y', or 'z'
	 *   [2] slice: 0 - 255
	 *
	 * Return: this, side effect of drawing on ctx
	 */
	renderSegmentationSlice(ctx, axis, slice) {
		// Don't need to do anything special for segmentation since it's
		// not user visible. Also, in the old version, the default image was black,
		// but the cube is zeroed out by default.
		this.segmentation.renderImageSlice(ctx, axis, slice);

		return this;
	}

	/* toggleSegment
	 *
	 * Given an axis, slice index, and normalized x and y cursor coordinates
	 * ([0, 1]), 0,0 being the top left, select the segment under the mouse.
	 *
	 * Required:
	 *   [0] axis: 'x', 'y', or 'z'
	 *   [1] slice: 0 - 255
	 *   [2] normx: 0...1
	 *   [3] normy: 0...1
	 *
	 * Return: segid
	 */
	toggleSegment (axis, slice, normx, normy) {
		let _this = this;
		let x,y,z;

		let sizex = _this.segmentation.size.x,
			sizey = _this.segmentation.size.y,
			sizez = _this.segmentation.size.z;

		if (axis === 'x') {
			x = slice,
			y = normx * sizey,
			z = normy * sizez;
		}
		else if (axis === 'y') {
			x = normx * sizex,
			y = slice,
			z = normy * sizez;
		}
		else if (axis === 'z') {
			x = normx * sizex,
			y = normy * sizey,
			z = slice;
		}

		x = Math.round(x);
		y = Math.round(y);
		z = Math.round(z);

		let segid = _this.segmentation.get(x, y, z);
		
		if (segid > 0) {
			_this.segments[segid] = !_this.segments[segid];
		}

		return segid;
	}
}

/* DataCube
 *
 * Efficiently represents a 3D image as a 1D array of integer values.
 *
 * Can be configured to use 8, 16, or 32 bit integers.
 *
 * Required:
 *  bytes: (int) 1, 2, or 4, specifies 8, 16, or 32 bit representation
 *  
 * Optional:
 *  size: { x: (int) pixels, y: (int) pixels, z: pixels}, default 256^3
 *
 * Return: self
 */
class DataCube {
	constructor (args) {
		this.bytes = args.bytes || 1;
		this.size = args.size || { x: 256, y: 256, z: 256 };
		this.cube = this.materialize();

		this.canvas_context = this.createImageContext();

		this.clean = true;
		this.loaded = false;

		this.faces = {
			x: [ 'y', 'z' ],
			y: [ 'x', 'z' ],
			z: [ 'x', 'y' ],
		};
	}

	// for internal use, makes a canvas for blitting images to
	createImageContext () {
		let canvas = document.createElement('canvas');
		canvas.width = this.size.x;
		canvas.height = this.size.y;

		return canvas.getContext('2d'); // used for accelerating XY plane image insertions
	}

	// for internal use, creates the data cube of the correct data type and size
	materialize () {
		let ArrayType = this.arrayType();

		let size = this.size;

		return new ArrayType(size.x * size.y * size.z);
	}

	/* clear
	 *
	 * Zero out the cube and reset clean and loaded flags.
	 *
	 * Required: None
	 *   
	 * Return: this
	 */
	clear () {
		this.cube.fill(0);
		this.clean = true;
		this.loaded = false;

		return this;
	}

	/* insertSquare
	 *
	 * Insert an XY aligned plane of data into the cube. 
	 *
	 * If the square extends outside the bounds of the cube, it is 
	 * partially copied where it overlaps.
	 *
	 * Required:
	 *   [0] square: A 1D array representing a 2D plane. 
	 *   [1] width
	 *
	 * Optional:
	 *   [3,4,5] x,y,z offsets into the cube for partial slice downloads  
	 *
	 * Return: this
	 */
	insertSquare (square, width, offsetx = 0, offsety = 0, offsetz = 0) {
		let _this = this;

		const xsize = _this.size.x,
			ysize = _this.size.y,
			zsize = _this.size.z;

		offsetz *= xsize * ysize;

		for (let i = 0; i < square.length; i++) {
			let x = offsetx + (i % width),
				y = offsety + (Math.floor(i / width));

			_this.cube[x + xsize * y + offsetz] = square[i];
		}

		_this.clean = false;

		return this;
	}

	/* insertCanvas
	 *
	 * Like insert square, but uses a canvas filled with an image instead.
	 *
	 * Required:
	 *   [0] canvas
	 *
	 * Optional:
	 *   [1,2,3] x,y,z offsets into the cube for partial downloads
	 *
	 * Return: this
	 */
	insertCanvas (canvas, offsetx = 0, offsety = 0, offsetz = 0) {
		let ctx = canvas.getContext('2d');
		let imgdata = ctx.getImageData(0, 0, canvas.width, canvas.height);
		return this.insertImageData(imgdata, canvas.width, offsetx, offsety, offsetz);
	}

	/* insertImage
	 *
	 * Like insert square, but uses an image object instead.
	 *
	 * Required:
	 *   [0] image
	 *
	 * Optional:
	 *   [1,2,3] x,y,z offsets into the cube for partial downloads
	 *
	 * Return: this
	 */
	insertImage (img, offsetx = 0, offsety = 0, offsetz = 0) {
		this.canvas_context.drawImage(img, 0, 0);
		let imgdata = this.canvas_context.getImageData(0, 0, img.width, img.height);
		return this.insertImageData(imgdata, img.width, offsetx, offsety, offsetz);
	}

	/* insertImageData
	 *
	 * Decodes a Uint8ClampedArray ImageData ([ R, G, B, A, .... ]) buffer
	 * into interger values and inserts them into the data cube.
	 *
	 * Required:
	 *	[0] imgdata: An ImageData object (e.g. from canvas.getImageData)
	 *  [1] width: width of the image in pixels, 
	 *		the height can be inferred from array length given this
	 *	[2,3,4] offsets of x,y,z for partial data
	 *
	 * Return: this
	 */
	insertImageData (imgdata, width, offsetx, offsety, offsetz) {
		let _this = this;

		let pixels = imgdata.data; // Uint8ClampedArray

		// This viewing of the Uint8 as a Uint32 allows for 
		// a memory stride of 4x larger, making reading and writing cheaper
		// as RAM is the slow thing here.
		let data32 = new Uint32Array(pixels.buffer); // creates a view, not an array

		// Note: on little endian machine, data32 is 0xaabbggrr, so it's already flipped
		// from the Uint8 RGBA

		let masks = {
			true: {
				1: 0x000000ff,
				2: 0x0000ffff,
				4: 0xffffffff,
			},
			false: {
				1: 0xff000000,
				2: 0xffff0000,
				4: 0xffffffff,				
			},
		};

		const mask = masks[this.isLittleEndian()][this.bytes];
		
		let x = 0, y = 0;
		
		const sizex = _this.size.x | 0,
			  zadj = (offsetz * _this.size.x * _this.size.y) | 0;
		
		for (y = width - 1; y >= 0; y--) {
			for (x = width - 1; x >= 0; x--) {
			
				_this.cube[
					(offsetx + x) + sizex * (offsety + y) + zadj
				] = data32[ x + y * width ] & mask;
			}
		}

		_this.clean = false;

		return this;
	}

	/* get
	 *
	 * Retrieve a particular index from the data cube.
	 *
	 * Not very efficient, but useful for some purposes. It's convenient
	 * to use this method rather than remember how to access the 3rd dimension
	 * in a 1D array.
	 *
	 * Required:
	 *   [0] x
	 *   [1] y
	 *   [2] z
	 *
	 * Return: value
	 */
	get (x, y, z) {
		return this.cube[x + this.size.x * y + this.size.x * this.size.y * z];
	}

	/* slice
	 * 
	 * Return a 2D slice of the data cube as a 1D array 
	 * of the same type.
	 * 
	 * x axis gets a yz plane, y gets xz, and z gets xy.
	 *
	 * z slicing is accelerated compared to the other two.
	 *
	 * Required:
	 *   axis: x, y, or z
	 *   index: 0 to size - 1 on that axis
	 * 
	 * Optional:
	 *   [2] copy - allocates new memory if true, otherwise returns a view on the underlying arraybuffer
	 *
	 * Return: 1d array
	 */
	slice (axis, index, copy = true) {
		let _this = this;

		if (index < 0 || index >= this.size[axis]) {
			throw new Error(index + ' is out of bounds.');
		}

		const xsize = _this.size.x,
			ysize = _this.size.y,
			zsize = _this.size.z;

		const xysize = xsize * ysize;

		let face = this.faces[axis];
		let ArrayType = this.arrayType();

		if (axis === 'z') {
			let byteoffset = index * xysize * this.bytes;

			if (copy) {
				let buf = _this.cube.buffer.slice(byteoffset, byteoffset + xysize * this.bytes);
				return new ArrayType(buf);
			} 
			else {
				return new ArrayType(_this.cube.buffer, byteoffset, xysize);
			}
		}

		let square = new ArrayType(this.size[face[0]] * this.size[face[1]]);

		// Note: order of loops is important for efficient memory access
		// and correct orientation of images. Consecutive x access is most efficient.

		let i = square.length - 1;
		if (axis === 'x') {
			for (let z = zsize - 1; z >= 0; --z) {
				for (let y = ysize - 1; y >= 0; --y) {
					square[i] = _this.cube[index + xsize * y + xysize * z];
					--i;
				}
			}
		}
		else if (axis === 'y') {
			// possible to make this more efficient with an array memcpy
			// as 256 x are consecutive, but no memcpy in browser.
			const yoffset = xsize * index;
			for (let z = zsize - 1; z >= 0; --z) {
				for (let x = xsize - 1; x >= 0; --x) { 
					square[i] = _this.cube[x + yoffset + xysize * z];
					--i;
				}
			}
		}

		return square;
	}

	/* imageSlice
	 *
	 * Generate an ImageData object that encodes a color 
	 * representation of an on-axis 2D slice of the data cube.
	 *
	 * Required:
	 *   [0] axis: 'x', 'y', or 'z'
	 *   [1] index: 0 - axis size - 1
	 *
	 * Return: imagedata
	 */
	imageSlice (axis, index) {
		let _this = this;

		let square = this.slice(axis, index, /*copy=*/false);

		let sizes = {
			x: [ _this.size.y, _this.size.z ],
			y: [ _this.size.x, _this.size.z ],
			z: [ _this.size.x, _this.size.y ],
		};

		let size = sizes[axis];

		// see https://developer.mozilla.org/en-US/docs/Web/API/Canvas_API/Tutorial/Pixel_manipulation_with_canvas
		let imgdata = this.canvas_context.createImageData(size[0], size[1]);

		let maskset = this.getRenderMaskSet();

		const rmask = maskset.r,
			gmask = maskset.g,
			bmask = maskset.b,
			amask = maskset.a;

		// if we break this for loop up by bytes, we can extract extra performance.
		// If we want to handle transparency efficiently, you'll want to break out the
		// 32 bit case so you can avoid an if statement.

		// you can also avoid doing the assignment for index 1 and 2 for 8 bit, and 2 for 16 bit
		// This code seemed more elegant to me though, so I won't prematurely optimize.

		let data = imgdata.data;

		let fixedalpha = this.bytes === 4 // no alpha channel w/ less than 4 bytes
			? 0x00000000 
			: 0xffffffff;

		let di = data.length - 4;
		for (let si = square.length - 1; si >= 0; si--) {
			data[di + 0] = (square[si] & rmask); 
			data[di + 1] = (square[si] & gmask) >>> 8;
			data[di + 2] = (square[si] & bmask) >>> 16;
			data[di + 3] = ((square[si] & amask) | fixedalpha) >>> 24; // can handle transparency specially if necessary
				
			di -= 4;
		}

		return imgdata;
	}

	/* grayImageSlice
	 *
	 * Generate an ImageData object that encodes a grayscale 
	 * representation of an on-axis 2D slice of the data cube.
	 *
	 * Required:
	 *   [0] axis: 'x', 'y', or 'z'
	 *   [1] index: 0 - axis size - 1
	 *
	 * Return: imagedata
	 */
	grayImageSlice (axis, index) {
		let _this = this;

		let square = this.slice(axis, index, /*copy=*/false);

		let sizes = {
			x: [ _this.size.y, _this.size.z ],
			y: [ _this.size.x, _this.size.z ],
			z: [ _this.size.x, _this.size.y ],
		};

		let size = sizes[axis];

		let imgdata = this.canvas_context.createImageData(size[0], size[1]);

		let maskset = this.getRenderMaskSet();

		const rmask = maskset.r;
		let data = imgdata.data;

		let di = data.length - 4;
		for (let si = square.length - 1; si >= 0; si--) {
			data[di + 0] = (square[si] & rmask); 
			data[di + 1] = (square[si] & rmask);
			data[di + 2] = (square[si] & rmask);
			data[di + 3] = 255; 
				
			di -= 4;
		}

		return imgdata;
	}

	/* renderImageSlice
	 *
	 * Render a 2D slice of the data cube to a provided 
	 * canvas context full vibrant color.
	 *
	 * Required:
	 * 	[0] context
	 *  [1] axis: 'x', 'y', or 'z'
	 *  [2] index: 0 to axis size - 1
	 *   
	 * Return: this
	 */
	renderImageSlice (context, axis, index) {
		var imgdata = this.imageSlice(axis, index);
		context.putImageData(imgdata, 0, 0);
		return this;
	}

	/* renderGrayImageSlice
	 *
	 * Render a 2D slice of the data cube to a provided 
	 * canvas context in grayscale.
	 *
	 * Required:
	 * 	[0] context
	 *  [1] axis: 'x', 'y', or 'z'
	 *  [2] index: 0 to axis size - 1
	 *   
	 * Return: this
	 */
	renderGrayImageSlice (context, axis, index) {
		var imgdata = this.grayImageSlice(axis, index);
		context.putImageData(imgdata, 0, 0);
		return this;
	}

	// http://stackoverflow.com/questions/504030/javascript-endian-encoding
	isLittleEndian () {
		var arr32 = new Uint32Array(1);
		var arr8 = new Uint8Array(arr32.buffer);
		arr32[0] = 255;

		let islittle = (arr8[0] === 255);

		this.isLittleEndian = () => islittle;

		return islittle;
	}

	// For internal use, return the right bitmask for rgba image slicing
	// depending on CPU endianess.
	getRenderMaskSet () {
		let bitmasks = {
			true: { // little endian, most architectures
				r: 0x000000ff,
				g: 0x0000ff00,
				b: 0x00ff0000,
				a: 0xff000000,
			},
			false: { // big endian, mostly ARM and some specialized equipment
				r: 0xff000000,
				g: 0x00ff0000,
				b: 0x0000ff00,
				a: 0x000000ff,
			},
		};

		return bitmasks[this.isLittleEndian()];
	}

	/* arrayType
	 *
	 * Return the right type of data cube array 
	 * depending on the bytes argument provided.
	 *
	 * Required: None
	 *   
	 * Return: one of Uint8ClampedArray, Uint16Array, or Uint32Array
	 */
	arrayType () {
		let choices = {
			1: Uint8ClampedArray,
			2: Uint16Array,
			4: Uint32Array,
		};

		let ArrayType = choices[this.bytes];

		if (ArrayType === undefined) {
			throw new Error(this.bytes + ' is not a valid typed array byte count.');
		}

		return ArrayType;
	}
}







