import { zipSync, strToU8 } from "fflate";

const EMU_WIDTH = 12_192_000;
const EMU_HEIGHT = 6_858_000;
const XML_DECLARATION =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const RELATIONSHIPS_NAMESPACE =
  "http://schemas.openxmlformats.org/package/2006/relationships";
const OFFICE_RELATIONSHIPS_NAMESPACE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

export function buildImagePptx(images: readonly Uint8Array[]): Uint8Array {
  if (images.length === 0) {
    throw new Error("A PowerPoint download requires at least one slide.");
  }

  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(contentTypesXml(images.length)),
    "_rels/.rels": strToU8(rootRelationshipsXml()),
    "ppt/presentation.xml": strToU8(presentationXml(images.length)),
    "ppt/_rels/presentation.xml.rels": strToU8(
      presentationRelationshipsXml(images.length),
    ),
    "ppt/presProps.xml": strToU8(presentationPropertiesXml()),
    "ppt/theme/theme1.xml": strToU8(themeXml()),
    "ppt/slideMasters/slideMaster1.xml": strToU8(slideMasterXml()),
    "ppt/slideMasters/_rels/slideMaster1.xml.rels": strToU8(
      slideMasterRelationshipsXml(),
    ),
    "ppt/slideLayouts/slideLayout1.xml": strToU8(slideLayoutXml()),
    "ppt/slideLayouts/_rels/slideLayout1.xml.rels": strToU8(
      slideLayoutRelationshipsXml(),
    ),
  };

  images.forEach((image, index) => {
    const slideNumber = index + 1;
    files[`ppt/slides/slide${slideNumber}.xml`] = strToU8(slideXml());
    files[`ppt/slides/_rels/slide${slideNumber}.xml.rels`] = strToU8(
      slideRelationshipsXml(slideNumber),
    );
    files[`ppt/media/image${slideNumber}.png`] = image;
  });

  return zipSync(files);
}

function contentTypesXml(slideCount: number): string {
  const slides = Array.from(
    { length: slideCount },
    (_, index) =>
      `<Override PartName="/ppt/slides/slide${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`,
  ).join("");
  return `${XML_DECLARATION}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/presProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presProps+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/>${slides}</Types>`;
}

function rootRelationshipsXml(): string {
  return `${XML_DECLARATION}<Relationships xmlns="${RELATIONSHIPS_NAMESPACE}"><Relationship Id="rId1" Type="${OFFICE_RELATIONSHIPS_NAMESPACE}/officeDocument" Target="ppt/presentation.xml"/></Relationships>`;
}

function presentationXml(slideCount: number): string {
  const slides = Array.from(
    { length: slideCount },
    (_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 3}"/>`,
  ).join("");
  return `${XML_DECLARATION}<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${OFFICE_RELATIONSHIPS_NAMESPACE}" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst>${slides}</p:sldIdLst><p:sldSz cx="${EMU_WIDTH}" cy="${EMU_HEIGHT}"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`;
}

function presentationRelationshipsXml(slideCount: number): string {
  const relationships = [
    `<Relationship Id="rId1" Type="${OFFICE_RELATIONSHIPS_NAMESPACE}/slideMaster" Target="slideMasters/slideMaster1.xml"/>`,
    `<Relationship Id="rId2" Type="${OFFICE_RELATIONSHIPS_NAMESPACE}/presProps" Target="presProps.xml"/>`,
  ];
  for (let index = 0; index < slideCount; index += 1) {
    relationships.push(
      `<Relationship Id="rId${index + 3}" Type="${OFFICE_RELATIONSHIPS_NAMESPACE}/slide" Target="slides/slide${index + 1}.xml"/>`,
    );
  }
  return `${XML_DECLARATION}<Relationships xmlns="${RELATIONSHIPS_NAMESPACE}">${relationships.join("")}</Relationships>`;
}

function presentationPropertiesXml(): string {
  return `${XML_DECLARATION}<p:presentationPr xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${OFFICE_RELATIONSHIPS_NAMESPACE}" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>`;
}

function slideMasterXml(): string {
  return `${XML_DECLARATION}<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${OFFICE_RELATIONSHIPS_NAMESPACE}" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst></p:sldMaster>`;
}

function slideMasterRelationshipsXml(): string {
  return `${XML_DECLARATION}<Relationships xmlns="${RELATIONSHIPS_NAMESPACE}"><Relationship Id="rId1" Type="${OFFICE_RELATIONSHIPS_NAMESPACE}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="${OFFICE_RELATIONSHIPS_NAMESPACE}/theme" Target="../theme/theme1.xml"/></Relationships>`;
}

function slideLayoutXml(): string {
  return `${XML_DECLARATION}<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${OFFICE_RELATIONSHIPS_NAMESPACE}" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="blank" preserve="1"><p:cSld name="Blank"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
}

function slideLayoutRelationshipsXml(): string {
  return `${XML_DECLARATION}<Relationships xmlns="${RELATIONSHIPS_NAMESPACE}"><Relationship Id="rId1" Type="${OFFICE_RELATIONSHIPS_NAMESPACE}/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`;
}

function slideXml(): string {
  return `${XML_DECLARATION}<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${OFFICE_RELATIONSHIPS_NAMESPACE}" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr><p:pic><p:nvPicPr><p:cNvPr id="2" name="Slide"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${EMU_WIDTH}" cy="${EMU_HEIGHT}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

function slideRelationshipsXml(slideNumber: number): string {
  return `${XML_DECLARATION}<Relationships xmlns="${RELATIONSHIPS_NAMESPACE}"><Relationship Id="rId1" Type="${OFFICE_RELATIONSHIPS_NAMESPACE}/slideLayout" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="${OFFICE_RELATIONSHIPS_NAMESPACE}/image" Target="../media/image${slideNumber}.png"/></Relationships>`;
}

function themeXml(): string {
  const solidFill = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
  const line = (width: number) =>
    `<a:ln w="${width}" cap="flat" cmpd="sng" algn="ctr">${solidFill}<a:prstDash val="solid"/></a:ln>`;
  const effect = "<a:effectStyle><a:effectLst/></a:effectStyle>";
  return `${XML_DECLARATION}<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Slide Kit"><a:themeElements><a:clrScheme name="Slide Kit"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="202124"/></a:dk2><a:lt2><a:srgbClr val="F4F5F7"/></a:lt2><a:accent1><a:srgbClr val="5B5BD6"/></a:accent1><a:accent2><a:srgbClr val="ED7D31"/></a:accent2><a:accent3><a:srgbClr val="A5A5A5"/></a:accent3><a:accent4><a:srgbClr val="FFC000"/></a:accent4><a:accent5><a:srgbClr val="5B9BD5"/></a:accent5><a:accent6><a:srgbClr val="70AD47"/></a:accent6><a:hlink><a:srgbClr val="0563C1"/></a:hlink><a:folHlink><a:srgbClr val="954F72"/></a:folHlink></a:clrScheme><a:fontScheme name="Slide Kit"><a:majorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="Slide Kit"><a:fillStyleLst>${solidFill}${solidFill}${solidFill}</a:fillStyleLst><a:lnStyleLst>${line(6350)}${line(12700)}${line(19050)}</a:lnStyleLst><a:effectStyleLst>${effect}${effect}${effect}</a:effectStyleLst><a:bgFillStyleLst>${solidFill}${solidFill}${solidFill}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
}
