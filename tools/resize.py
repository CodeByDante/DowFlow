from PIL import Image

def resize_icon(input_path, output_path, size=(128, 128)):
    img = Image.open(input_path)
    img.thumbnail(size, Image.Resampling.LANCZOS)
    
    # Create a new image with transparent background
    new_img = Image.new("RGBA", size, (0, 0, 0, 0))
    
    # Paste the original image onto the center of the new image
    paste_x = (size[0] - img.width) // 2
    paste_y = (size[1] - img.height) // 2
    new_img.paste(img, (paste_x, paste_y))
    
    new_img.save(output_path, "PNG")

resize_icon(r"c:\Users\Gonzalo\Desktop\Nueva carpeta (5)\descargador de videos\icons\@twistedbrody.png", r"c:\Users\Gonzalo\Desktop\Nueva carpeta (5)\descargador de videos\extension\icons\icon.png")
